import { describe, it, expect } from 'vitest';
import { exportSQLAlchemy } from '@/lib/data/code-export/sqlalchemy-export';
import { DatabaseType } from '@/lib/domain/database-type';
import type { Diagram } from '@/lib/domain/diagram';
import type { DBTable } from '@/lib/domain/db-table';
import type { DBField } from '@/lib/domain/db-field';
import type { DBRelationship } from '@/lib/domain/db-relationship';

import type { DBIndex } from '@/lib/domain/db-index';
import {
    DBCustomTypeKind,
    type DBCustomType,
} from '@/lib/domain/db-custom-type';

// Helpers modeled after existing export tests
let idCounter = 0;
const testId = () => `test-${++idCounter}`;
const testTime = Date.now();

function mkField(overrides: Partial<DBField>): DBField {
    return {
        id: testId(),
        name: 'field',
        type: { id: 'text', name: 'text' },
        primaryKey: false,
        nullable: true,
        unique: false,
        increment: false,
        createdAt: testTime,
        ...overrides,
    } as unknown as DBField;
}

function mkTable(overrides: Partial<DBTable>): DBTable {
    return {
        id: testId(),
        name: 'table',
        schema: 'public',
        isView: false,
        fields: [],
        indexes: [],
        createdAt: testTime,
        x: 0,
        y: 0,
        width: 200,
        ...overrides,
    } as unknown as DBTable;
}

function mkRel(overrides: Partial<DBRelationship>): DBRelationship {
    return {
        id: testId(),
        sourceTableId: '',
        sourceFieldId: '',
        targetTableId: '',
        targetFieldId: '',
        sourceCardinality: 'one',
        targetCardinality: 'many',
        createdAt: testTime,
        ...overrides,
    } as unknown as DBRelationship;
}

function mkDiagram(overrides: Partial<Diagram>): Diagram {
    return {
        id: testId(),
        name: 'diagram',
        databaseType: DatabaseType.POSTGRESQL,
        tables: [],
        relationships: [],
        customTypes: [],
        createdAt: testTime,
        updatedAt: testTime,
        ...overrides,
    } as unknown as Diagram;
}

describe('SQLAlchemy Export', () => {
    it('emits schema and table comment', () => {
        const t = mkTable({
            name: 'courses',
            comments: 'Course catalog',
            fields: [
                mkField({
                    name: 'course_id',
                    type: { id: 'varchar', name: 'varchar' },
                    primaryKey: true,
                    nullable: false,
                }),
                mkField({
                    name: 'title',
                    type: { id: 'varchar', name: 'varchar' },
                    nullable: false,
                }),
            ],
        });
        const diagram = mkDiagram({
            tables: [t],
            databaseType: DatabaseType.POSTGRESQL,
        });
        const py = exportSQLAlchemy(diagram);
        expect(py).toContain('__tablename__ = "courses"');
        expect(py).toContain('__table_args__ = ({"schema": "public"},)');
        expect(py).toContain('__doc__ = """Course catalog"""');
    });

    it('renders FK and one-to-many relationships with lazy selectin and cascade', () => {
        const a = mkTable({
            id: 'a',
            name: 'authors',
            fields: [
                mkField({
                    id: 'aid',
                    name: 'author_id',
                    type: { id: 'bigint', name: 'bigint' },
                    primaryKey: true,
                    nullable: false,
                }),
            ],
        });
        const b = mkTable({
            id: 'b',
            name: 'books',
            fields: [
                mkField({
                    id: 'bid',
                    name: 'book_id',
                    type: { id: 'bigint', name: 'bigint' },
                    primaryKey: true,
                    nullable: false,
                }),
                mkField({
                    id: 'baid',
                    name: 'author_id',
                    type: { id: 'bigint', name: 'bigint' },
                    nullable: false,
                }),
            ],
        });
        const rel = mkRel({
            sourceTableId: 'a',
            sourceFieldId: 'aid',
            targetTableId: 'b',
            targetFieldId: 'baid',
            sourceCardinality: 'one',
            targetCardinality: 'many',
        });

        const diagram = mkDiagram({
            tables: [a, b],
            relationships: [rel],
            databaseType: DatabaseType.POSTGRESQL,
        });
        const py = exportSQLAlchemy(diagram);

        // FK includes schema-qualified ref
        expect(py).toContain('sa.ForeignKey("public.authors.author_id")');

        // Relationships (collection)
        expect(py).toMatch(
            /books: Mapped\[list\[Books\]\] = relationship\("Books", back_populates="authors", lazy="selectin", cascade="all, delete-orphan"\)/
        );
        // Relationships (scalar)
        expect(py).toMatch(
            /authors: Mapped\[Authors\] = relationship\("Authors", back_populates="books", lazy="selectin"\)/
        );
    });

    it('handles composite primary keys via PrimaryKeyConstraint', () => {
        const t = mkTable({
            name: 'enrollments',
            fields: [
                mkField({
                    name: 'student_id',
                    type: { id: 'bigint', name: 'bigint' },
                    primaryKey: true,
                    nullable: false,
                }),
                mkField({
                    name: 'offering_id',
                    type: { id: 'bigint', name: 'bigint' },
                    primaryKey: true,
                    nullable: false,
                }),
                mkField({
                    name: 'status',
                    type: { id: 'varchar', name: 'varchar' },
                    nullable: false,
                }),
            ],
        });
        const diagram = mkDiagram({
            tables: [t],
            databaseType: DatabaseType.POSTGRESQL,
        });
        const py = exportSQLAlchemy(diagram);

        expect(py).toContain(
            'sa.PrimaryKeyConstraint("student_id", "offering_id")'
        );
        expect(py).not.toMatch(/student_id[^\n]*primary_key=True/);
        expect(py).not.toMatch(/offering_id[^\n]*primary_key=True/);
    });

    it('skips duplicate PK index and single-column unique duplicates', () => {
        const f1 = mkField({
            id: 'f1',
            name: 'id',
            type: { id: 'uuid', name: 'uuid' },
            primaryKey: true,
            nullable: false,
        });
        const f2 = mkField({
            id: 'f2',
            name: 'code',
            type: { id: 'varchar', name: 'varchar' },
            unique: true,
            nullable: false,
        });
        const t = mkTable({
            name: 'items',
            fields: [f1, f2],
            indexes: [
                {
                    id: testId(),
                    name: 'idx_items_id',
                    unique: false,
                    fieldIds: ['f1'],
                    createdAt: testTime,
                },
                {
                    id: testId(),
                    name: 'uq_items_code',
                    unique: true,
                    fieldIds: ['f2'],
                    createdAt: testTime,
                },
            ] as DBIndex[],
        });
        const diagram = mkDiagram({
            tables: [t],
            databaseType: DatabaseType.POSTGRESQL,
        });
        const py = exportSQLAlchemy(diagram);

        // PK-duplicate index should not be emitted
        expect(py).not.toContain('sa.Index("idx_items_id"');
        // Single-column unique already on column should not add UniqueConstraint
        expect(py).not.toContain('sa.UniqueConstraint("code"');
    });

    it('emits many-to-many association table with schema and secondary usage', () => {
        const a = mkTable({
            id: 'a',
            name: 'authors',
            fields: [
                mkField({
                    id: 'aid',
                    name: 'author_id',
                    primaryKey: true,
                    nullable: false,
                    type: { id: 'bigint', name: 'bigint' },
                }),
            ],
        });
        const b = mkTable({
            id: 'b',
            name: 'books',
            fields: [
                mkField({
                    id: 'bid',
                    name: 'book_id',
                    primaryKey: true,
                    nullable: false,
                    type: { id: 'bigint', name: 'bigint' },
                }),
            ],
        });
        const rel = mkRel({
            sourceTableId: 'a',
            sourceFieldId: 'aid',
            targetTableId: 'b',
            targetFieldId: 'bid',
            sourceCardinality: 'many',
            targetCardinality: 'many',
        });
        const diagram = mkDiagram({
            tables: [a, b],
            relationships: [rel],
            databaseType: DatabaseType.POSTGRESQL,
        });
        const py = exportSQLAlchemy(diagram);

        // assoc table name present with schema argument
        expect(py).toContain(
            'assoc_authors_books_0 = Table("assoc_authors_books_0", Base.metadata, schema="public"'
        );
        // columns present in association table
        expect(py).toContain(
            'sa.Column("author_id", sa.ForeignKey("public.authors.author_id"), primary_key=True)'
        );
        expect(py).toContain(
            'sa.Column("book_id", sa.ForeignKey("public.books.book_id"), primary_key=True)'
        );
        // relationship secondary usage present
        expect(py).toMatch(
            /relationship\("Books", secondary=assoc_authors_books_0/
        );
        expect(py).toMatch(
            /relationship\("Authors", secondary=assoc_authors_books_0/
        );
    });

    it('maps Postgres JSONB/UUID/INET and Array element inference', () => {
        const t = mkTable({
            name: 'pg_types',
            fields: [
                mkField({
                    name: 'id',
                    type: { id: 'uuid', name: 'uuid' },
                    primaryKey: true,
                    nullable: false,
                }),
                mkField({
                    name: 'payload',
                    type: { id: 'jsonb', name: 'jsonb' },
                }),
                mkField({ name: 'ip', type: { id: 'inet', name: 'inet' } }),
                mkField({
                    name: 'tags',
                    type: { id: 'varchar[]', name: 'varchar[]' },
                }),
                mkField({
                    name: 'uuids',
                    type: { id: 'uuid[]', name: 'uuid[]' },
                }),
            ],
        });
        const diagram = mkDiagram({
            tables: [t],
            databaseType: DatabaseType.POSTGRESQL,
        });
        const py = exportSQLAlchemy(diagram);

        expect(py).toContain('from sqlalchemy.dialects.postgresql import');
        expect(py).toContain('JSONB');
        expect(py).toContain('INET');
        expect(py).toContain('UUID');
        expect(py).toMatch(
            /payload: Mapped\[dict\[str, Any\]\] = mapped_column\(JSONB\)/
        );
        expect(py).toMatch(/ip: Mapped\[str\] = mapped_column\(INET\)/);
        expect(py).toMatch(
            /tags: Mapped\[list\[str\]\] = mapped_column\(sa.ARRAY\(sa.String/
        );
        expect(py).toMatch(
            /uuids: Mapped\[list\[str\]\] = mapped_column\(sa.ARRAY\(UUID\)\)/
        );
    });

    it('uses MySQL JSON and tinyint(1) -> Boolean', () => {
        const t = mkTable({
            name: 'mx',
            fields: [
                mkField({
                    name: 'id',
                    type: { id: 'integer', name: 'integer' },
                    primaryKey: true,
                    nullable: false,
                }),
                mkField({ name: 'conf', type: { id: 'json', name: 'json' } }),
                mkField({
                    name: 'flag',
                    type: { id: 'tinyint(1)', name: 'tinyint(1)' },
                }),
            ],
        });
        const diagram = mkDiagram({
            tables: [t],
            databaseType: DatabaseType.MYSQL,
        });
        const py = exportSQLAlchemy(diagram);

        expect(py).toContain('from sqlalchemy.dialects.mysql import JSON');
        expect(py).toMatch(
            /conf: Mapped\[dict\[str, Any\]\] = mapped_column\(JSON\)/
        );
        expect(py).toMatch(
            /flag: Mapped\[bool\] = mapped_column\(sa.Boolean\)/
        );
    });

    it('uses SQL Server types UNIQUEIDENTIFIER and DATETIME2 where applicable', () => {
        const t = mkTable({
            name: 'sx',
            fields: [
                mkField({
                    name: 'id',
                    type: { id: 'uuid', name: 'uuid' },
                    primaryKey: true,
                    nullable: false,
                }),
                mkField({
                    name: 'at',
                    type: { id: 'datetime2', name: 'datetime2' },
                }),
            ],
        });
        const diagram = mkDiagram({
            tables: [t],
            databaseType: DatabaseType.SQL_SERVER,
        });
        const py = exportSQLAlchemy(diagram);

        expect(py).toContain(
            'from sqlalchemy.dialects.mssql import DATETIME2, UNIQUEIDENTIFIER'
        );
        expect(py).toMatch(
            /id: Mapped\[str\] = mapped_column\(UNIQUEIDENTIFIER, primary_key=True/
        );
        expect(py).toMatch(
            /at: Mapped\[datetime\.datetime\] = mapped_column\(DATETIME2\)/
        );
    });

    it('emits custom enum types using sa.Enum with values and optional schema', () => {
        const t = mkTable({
            name: 'e',
            fields: [
                mkField({
                    name: 'status',
                    type: { id: 'status', name: 'status' },
                }),
            ],
        });
        const diagram = mkDiagram({
            tables: [t],
            customTypes: [
                {
                    id: 'ct1',
                    name: 'status',
                    kind: DBCustomTypeKind.enum,
                    values: ['NEW', 'DONE'],
                    schema: 'public',
                    createdAt: testTime,
                } as DBCustomType,
            ],
        });
        const py = exportSQLAlchemy(diagram);

        expect(py).toMatch(
            /status: Mapped\[str\] = mapped_column\(sa.Enum\("NEW", "DONE", name="status", schema="public"\)\)/
        );
    });

    it('adds field-level comments above columns', () => {
        const t = mkTable({
            name: 'notes',
            fields: [
                mkField({
                    name: 'id',
                    type: { id: 'integer', name: 'integer' },
                    primaryKey: true,
                    nullable: false,
                    comments: 'PK',
                }),
                mkField({
                    name: 'body',
                    type: { id: 'text', name: 'text' },
                    comments: 'Free-form notes',
                }),
            ],
        });
        const diagram = mkDiagram({ tables: [t] });
        const py = exportSQLAlchemy(diagram);

        expect(py).toMatch(/# PK\n\s*id: Mapped\[int\] =/);
        expect(py).toMatch(/# Free-form notes\n\s*body: Mapped\[str\] =/);
    });
});
