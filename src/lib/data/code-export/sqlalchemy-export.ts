import type { Diagram } from '@/lib/domain/diagram';
import type { DBTable } from '@/lib/domain/db-table';
import type { DBField } from '@/lib/domain/db-field';
import type { DBRelationship } from '@/lib/domain/db-relationship';
import { defaultSchemas } from '@/lib/data/default-schemas';
import { DatabaseType } from '@/lib/domain/database-type';
import { DBCustomTypeKind } from '@/lib/domain/db-custom-type';

function toPascalCase(name: string): string {
    return name
        .replace(/[_\-\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
        .replace(/^(.)/, (m) => m.toUpperCase());
}

function pyIdentifier(name: string): string {
    // Basic sanitization: replace invalid chars with underscore
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

// Simple pluralization helper to avoid typos like "summarys" -> "summaries"
function pluralize(name: string): string {
    const lower = name.toLowerCase();
    // Common English rules
    if (/(s|x|z|ch|sh)$/.test(lower)) return `${name}es`;
    if (/[^aeiou]y$/.test(lower)) return `${name.slice(0, -1)}ies`;
    return `${name}s`;
}

function formatPyInlineComment(
    comment?: string | null,
    indent = '    '
): string {
    if (!comment) return '';
    // Replace CRLF with LF, trim trailing spaces, and split
    const sanitized = comment.replace(/\r?\n/g, '\n').trim();
    if (!sanitized) return '';
    return (
        sanitized
            .split('\n')
            .map((line) => `${indent}# ${line}`)
            .join('\n') + '\n'
    );
}

type DialectSymbols = {
    postgres: Set<string>;
    mysql: Set<string>;
    mssql: Set<string>;
};

function saTypeFromField(
    field: DBField,
    databaseType: DatabaseType,
    enumTypeMap?: Map<string, { values: string[]; schema?: string | null }>,
    dialectSymbols?: DialectSymbols
): string {
    const t = field.type.name.toLowerCase();

    // Custom Enum types
    if (enumTypeMap && enumTypeMap.has(field.type.name)) {
        const info = enumTypeMap.get(field.type.name)!;
        const vals = info.values.map((v) => JSON.stringify(v)).join(', ');
        const schemaArg = info.schema ? `, schema="${info.schema}"` : '';
        return `sa.Enum(${vals}, name="${field.type.name}"${schemaArg})`;
    }

    // Helper: ARRAY element inference like "varchar[]", "integer[]", "uuid[]"
    if (t.endsWith('[]')) {
        const base = t.slice(0, -2);
        const elemField: DBField = {
            ...field,
            type: { ...field.type, name: base },
        } as DBField;
        const elemType = saTypeFromField(
            elemField,
            databaseType,
            enumTypeMap,
            dialectSymbols
        );
        return `sa.ARRAY(${elemType})`;
    }

    // Numeric
    if (t === 'integer' || t === 'int') return 'sa.Integer';
    if (t === 'bigint') return 'sa.BigInteger';
    if (t === 'smallint' || t === 'int2') return 'sa.SmallInteger';
    if (t === 'decimal' || t === 'numeric')
        return field.precision
            ? field.scale
                ? `sa.Numeric(precision=${field.precision}, scale=${field.scale})`
                : `sa.Numeric(precision=${field.precision})`
            : 'sa.Numeric';
    if (t === 'double' || t === 'double precision' || t === 'float8')
        return 'sa.Float';
    if (t === 'real' || t === 'float' || t === 'float4') return 'sa.Float';

    // Strings / text
    if (t.includes('varchar') || t === 'character varying') {
        const size = field.characterMaximumLength
            ? parseInt(field.characterMaximumLength)
            : undefined;
        return size && size > 0 ? `sa.String(${size})` : 'sa.String';
    }
    if (t === 'char' || t === 'character') {
        const size = field.characterMaximumLength
            ? parseInt(field.characterMaximumLength)
            : undefined;
        return size && size > 0 ? `sa.String(${size})` : 'sa.String';
    }
    if (t === 'text') return 'sa.Text';

    // Date/Time
    if (t === 'date') return 'sa.Date';
    if (t.includes('timestamp')) return 'sa.DateTime(timezone=True)';
    if (t === 'time') return 'sa.Time';

    // Boolean
    if (t === 'boolean' || t === 'bool') return 'sa.Boolean';
    if (databaseType === DatabaseType.MYSQL && t.startsWith('tinyint'))
        return 'sa.Boolean';

    // Binary
    if (t === 'bytea' || t === 'blob' || t === 'binary' || t === 'varbinary')
        return 'sa.LargeBinary';

    // UUID
    if (t === 'uuid') {
        if (databaseType === DatabaseType.POSTGRESQL) {
            dialectSymbols?.postgres.add('UUID');
            return 'UUID';
        }
        if (databaseType === DatabaseType.SQL_SERVER) {
            dialectSymbols?.mssql.add('UNIQUEIDENTIFIER');
            return 'UNIQUEIDENTIFIER';
        }
        return 'sa.String';
    }

    // JSON
    if (t === 'json' || t === 'jsonb') {
        if (databaseType === DatabaseType.POSTGRESQL) {
            dialectSymbols?.postgres.add('JSONB');
            return 'JSONB';
        }
        if (databaseType === DatabaseType.MYSQL) {
            dialectSymbols?.mysql.add('JSON');
            return 'JSON';
        }
        return 'sa.JSON';
    }

    // Arrays (fallback)
    if (t === 'array') return 'sa.ARRAY(sa.Text)';

    // PostgreSQL-specific
    if (databaseType === DatabaseType.POSTGRESQL) {
        if (t === 'inet') {
            dialectSymbols?.postgres.add('INET');
            return 'INET';
        }
        if (t === 'cidr') {
            dialectSymbols?.postgres.add('CIDR');
            return 'CIDR';
        }
        if (t === 'macaddr') {
            dialectSymbols?.postgres.add('MACADDR');
            return 'MACADDR';
        }
        if (t === 'citext') {
            dialectSymbols?.postgres.add('CITEXT');
            return 'CITEXT';
        }
        if (t === 'hstore') {
            dialectSymbols?.postgres.add('HSTORE');
            return 'HSTORE';
        }
        if (t === 'money') {
            dialectSymbols?.postgres.add('MONEY');
            return 'MONEY';
        }
        if (t === 'interval') {
            return 'sa.Interval';
        }
    }

    // MySQL-specific
    if (databaseType === DatabaseType.MYSQL) {
        if (t === 'mediumtext') {
            dialectSymbols?.mysql.add('MEDIUMTEXT');
            return 'MEDIUMTEXT';
        }
        if (t === 'longtext') {
            dialectSymbols?.mysql.add('LONGTEXT');
            return 'LONGTEXT';
        }
        if (t === 'year') {
            dialectSymbols?.mysql.add('YEAR');
            return 'YEAR';
        }
        if (t === 'set') {
            dialectSymbols?.mysql.add('SET');
            return 'SET';
        }
    }

    // MSSQL-specific
    if (databaseType === DatabaseType.SQL_SERVER) {
        if (t === 'datetime2') {
            dialectSymbols?.mssql.add('DATETIME2');
            return 'DATETIME2';
        }
        if (t === 'smalldatetime') {
            dialectSymbols?.mssql.add('SMALLDATETIME');
            return 'SMALLDATETIME';
        }
        if (t === 'money') {
            dialectSymbols?.mssql.add('MONEY');
            return 'MONEY';
        }
        if (t === 'nvarchar' || t === 'nchar' || t === 'ntext') {
            // Prefer generic Unicode strings
            const size = field.characterMaximumLength
                ? parseInt(field.characterMaximumLength)
                : undefined;
            return size && size > 0 ? `sa.Unicode(${size})` : 'sa.UnicodeText';
        }
    }

    // Fallback
    return 'sa.String';
}

function pyTypeFromField(field: DBField): string {
    const t = field.type.name.toLowerCase();

    // Numeric → Python types
    if (t === 'integer' || t === 'int' || t === 'smallint' || t === 'int2')
        return 'int';
    if (t === 'bigint') return 'int';
    if (t === 'decimal' || t === 'numeric') return 'Decimal';
    if (
        t === 'double' ||
        t === 'double precision' ||
        t === 'float' ||
        t === 'float4' ||
        t === 'float8' ||
        t === 'real'
    )
        return 'float';

    // Strings / text
    if (
        t.includes('varchar') ||
        t === 'character varying' ||
        t === 'char' ||
        t === 'character' ||
        t === 'text'
    )
        return 'str';

    // Date/Time
    if (t === 'date') return 'datetime.date';
    if (t.includes('timestamp')) return 'datetime.datetime';
    if (t === 'datetime2' || t === 'smalldatetime' || t === 'datetime')
        return 'datetime.datetime';
    if (t === 'time') return 'datetime.time';

    // Boolean
    if (t === 'boolean' || t === 'bool') return 'bool';
    if (t.startsWith('tinyint')) return 'bool';

    // Binary
    if (t === 'bytea' || t === 'blob' || t === 'binary' || t === 'varbinary')
        return 'bytes';

    // UUID
    if (t === 'uuid') return 'str';

    // JSON
    if (t === 'json' || t === 'jsonb') return 'dict[str, Any]';

    // Arrays (fallback)
    if (t.endsWith('[]') || t === 'array') return 'list[str]';

    // Fallback
    return 'str';
}

function renderColumn(
    field: DBField,
    databaseType: DatabaseType,
    options: {
        isCompositePK: boolean;
        pkFieldNames: Set<string>;
    },
    enumTypeMap: Map<string, { values: string[]; schema?: string | null }>,
    dialectSymbols: DialectSymbols,
    fkSpec?: { refTable: DBTable; refField: DBField }
): string {
    const positionalArgs: string[] = [];
    const kwargs: string[] = [];

    // Type (first positional)
    positionalArgs.push(
        saTypeFromField(field, databaseType, enumTypeMap, dialectSymbols)
    );

    // Primary key
    if (field.primaryKey && !options.isCompositePK)
        kwargs.push('primary_key=True');

    // Auto increment hint
    if (field.increment) kwargs.push('autoincrement=True');

    // Nullability
    if (field.nullable === false) kwargs.push('nullable=False');

    // Unique
    if (field.unique && !field.primaryKey) kwargs.push('unique=True');

    // Default
    if (field.default && !field.increment) {
        const d = field.default.trim();
        if (/^now\(\)$/i.test(d) || /current_timestamp/i.test(d)) {
            kwargs.push('server_default=sa.text("CURRENT_TIMESTAMP")');
        } else if (/^nextval\(/i.test(d)) {
            // leave it to DB side; optional: server_default=sa.text("nextval('seq')")
            kwargs.push(`server_default=sa.text("${d.replace(/"/g, '\\"')}")`);
        } else if (/^\d+(\.\d+)?$/.test(d)) {
            kwargs.push(`server_default=sa.text("${d}")`);
        } else if (/^'.*'$/.test(d) || /^".*"$/.test(d)) {
            // strip quotes and use literal string
            const lit = d.replace(/^['"]|['"]$/g, '').replace(/"/g, '\\"');
            kwargs.push(`server_default=sa.text("'${lit}'")`);
        } else {
            const lit = d.replace(/"/g, '\\"');
            kwargs.push(`server_default=sa.text("${lit}")`);
        }
    }

    // Heuristic timestamp defaults if field names look standard and no explicit default was set
    if (!field.default) {
        const fnameLower = field.name.toLowerCase();
        if (/(^|_)created_at$/.test(fnameLower)) {
            kwargs.push('server_default=sa.func.now()');
        }
        if (/(^|_)updated_at$/.test(fnameLower)) {
            kwargs.push('server_default=sa.func.now()');
            kwargs.push('onupdate=sa.func.now()');
        }
    }

    // ForeignKey
    if (fkSpec) {
        const schema = fkSpec.refTable.schema
            ? `${fkSpec.refTable.schema}.`
            : '';
        const target = `${schema}${fkSpec.refTable.name}.${fkSpec.refField.name}`;
        // ensure type is first positional, then ForeignKey
        positionalArgs.push(`sa.ForeignKey("${target}")`);
        // Helpful index on FK columns for query performance
        kwargs.push('index=True');
    }

    const name = pyIdentifier(field.name);
    let annot = pyTypeFromField(field);
    const tname = field.type.name.toLowerCase();
    // Python-side default for UUIDs
    if (tname === 'uuid') {
        kwargs.push('default=uuid.uuid4');
    }
    if (tname.endsWith('[]') || tname === 'array') {
        const base = tname.endsWith('[]') ? tname.slice(0, -2) : 'text';
        const elemField: DBField = {
            ...field,
            // Narrow type to mutable shape for name override without using any
            type: {
                ...(field.type as { id?: string; name: string }),
                name: base,
            },
        } as DBField;
        const elemAnnot = pyTypeFromField(elemField);
        annot = `list[${elemAnnot}]`;
    }
    const argsJoined = [...positionalArgs, ...kwargs].join(', ');
    const comment = formatPyInlineComment(field.comments);
    const line = `    ${name}: Mapped[${annot}] = mapped_column(${argsJoined})`;
    return comment ? comment + line : line;
}

function classifyRelationship(rel: DBRelationship, tables: DBTable[]) {
    const source = tables.find((t) => t.id === rel.sourceTableId)!;
    const target = tables.find((t) => t.id === rel.targetTableId)!;

    const sourceField = source.fields.find((f) => f.id === rel.sourceFieldId)!;
    const targetField = target.fields.find((f) => f.id === rel.targetFieldId)!;

    // Determine where FK lives
    if (rel.sourceCardinality === 'one' && rel.targetCardinality === 'many') {
        return {
            kind: 'one_to_many' as const,
            one: source,
            oneField: sourceField,
            many: target,
            manyField: targetField,
        };
    }
    if (rel.sourceCardinality === 'many' && rel.targetCardinality === 'one') {
        return {
            kind: 'one_to_many' as const,
            one: target,
            oneField: targetField,
            many: source,
            manyField: sourceField,
        };
    }
    if (rel.sourceCardinality === 'one' && rel.targetCardinality === 'one') {
        return {
            kind: 'one_to_one' as const,
            a: source,
            aField: sourceField,
            b: target,
            bField: targetField,
        };
    }
    return {
        kind: 'many_to_many' as const,
        a: source,
        aField: sourceField,
        b: target,
        bField: targetField,
    };
}

export function exportSQLAlchemy(diagram: Diagram): string {
    const tables = diagram.tables || [];
    const relationships = diagram.relationships || [];

    if (!tables.length) return '';

    // Build quick lookup for relationships by (table, field) used as FK holder
    const fkByTableField = new Map<
        string,
        { refTable: DBTable; refField: DBField }
    >();

    relationships.forEach((rel) => {
        const cls = classifyRelationship(rel, tables);
        if (cls.kind === 'one_to_many') {
            // FK lives on many side referencing one side
            fkByTableField.set(`${cls.many.id}:${cls.manyField.id}`, {
                refTable: cls.one,
                refField: cls.oneField,
            });
        } else if (cls.kind === 'one_to_one') {
            // Assume FK on "a" side
            fkByTableField.set(`${cls.a.id}:${cls.aField.id}`, {
                refTable: cls.b,
                refField: cls.bField,
            });
        }
        // many_to_many handled later via association tables
    });

    // Prepare association tables for many-to-many
    const m2m: Array<{
        name: string;
        a: DBTable;
        aField: DBField;
        b: DBTable;
        bField: DBField;
        schema?: string | null;
    }> = [];

    relationships.forEach((rel, idx) => {
        const cls = classifyRelationship(rel, tables);
        if (cls.kind === 'many_to_many') {
            const safeName = pyIdentifier(
                `assoc_${cls.a.name}_${cls.b.name}_${idx}`
            );
            m2m.push({
                name: safeName,
                a: cls.a,
                aField: cls.aField,
                b: cls.b,
                bField: cls.bField,
                schema: cls.a.schema || cls.b.schema,
            });
        }
    });

    // Build enum type map from custom types (enum)
    const enumTypeMap = new Map<
        string,
        { values: string[]; schema?: string | null }
    >();
    (diagram.customTypes || []).forEach((ct) => {
        if (
            ct.kind === DBCustomTypeKind.enum &&
            ct.values &&
            ct.values.length
        ) {
            enumTypeMap.set(ct.name, {
                values: ct.values,
                schema: ct.schema || undefined,
            });
        }
    });

    // Prepare dialect symbol trackers
    const dialectSymbols: DialectSymbols = {
        postgres: new Set<string>(),
        mysql: new Set<string>(),
        mssql: new Set<string>(),
    };

    // We'll build importLines after scanning tables/columns to know dialect symbols
    const baseImportLines: string[] = [
        'from __future__ import annotations',
        'import datetime',
        'import uuid',
        'from decimal import Decimal',
        'from typing import Any',
        'import sqlalchemy as sa',
        'from sqlalchemy import Table',
        'from sqlalchemy.orm import DeclarativeBase, relationship, Mapped, mapped_column',
    ];

    // Optional: per-schema metadata isn't necessary; we can use __table_args__ with schema per class

    // Render association tables first
    const assocBlocks = m2m
        .map((j) => {
            const schemaName = j.schema || defaultSchemas[diagram.databaseType];
            const schemaArg = schemaName ? `, schema="${schemaName}"` : '';
            const aFull = `${j.a.schema ? j.a.schema + '.' : ''}${j.a.name}.${j.aField.name}`;
            const bFull = `${j.b.schema ? j.b.schema + '.' : ''}${j.b.name}.${j.bField.name}`;
            return (
                `${j.name} = Table("${j.name}", Base.metadata${schemaArg},\n` +
                `    sa.Column("${pyIdentifier(j.aField.name)}", sa.ForeignKey("${aFull}"), primary_key=True),\n` +
                `    sa.Column("${pyIdentifier(j.bField.name)}", sa.ForeignKey("${bFull}"), primary_key=True),\n` +
                `)\n`
            );
        })
        .join('\n');

    // Helper for relationship naming
    function relAttrName(tableName: string): string {
        // pluralize crudely for many side, keep singular otherwise - simplistic
        if (tableName.endsWith('s')) return pyIdentifier(tableName);
        return pyIdentifier(pluralize(tableName));
    }

    // Build class code for each table
    const classBlocks = tables
        .filter((t) => !t.isView)
        .map((table) => {
            const className = toPascalCase(table.name);
            const schemaName =
                table.schema || defaultSchemas[diagram.databaseType];

            // Determine PK composition
            const pkFields = table.fields.filter((f) => f.primaryKey);
            const isCompositePK = pkFields.length > 1;
            const pkFieldNames = new Set<string>(pkFields.map((f) => f.name));

            // Columns
            const cols = table.fields
                .map((f) =>
                    renderColumn(
                        f,
                        diagram.databaseType,
                        { isCompositePK, pkFieldNames },
                        enumTypeMap,
                        dialectSymbols,
                        fkByTableField.get(`${table.id}:${f.id}`)
                    )
                )
                .join('\n');

            // Relationships on this table
            const relLines: string[] = [];
            const relLineSet = new Set<string>();

            relationships.forEach((rel) => {
                const cls = classifyRelationship(rel, tables);
                if (cls.kind === 'one_to_many') {
                    if (cls.one.id === table.id) {
                        // one side: collection
                        const targetClass = toPascalCase(cls.many.name);
                        const attr = relAttrName(cls.many.name);
                        {
                            const line = `    ${attr}: Mapped[list[${targetClass}]] = relationship("${targetClass}", back_populates="${pyIdentifier(cls.one.name)}", lazy="selectin", cascade="all, delete-orphan")`;
                            if (!relLineSet.has(line)) {
                                relLines.push(line);
                                relLineSet.add(line);
                            }
                        }
                    } else if (cls.many.id === table.id) {
                        // many side: scalar backref property on many side uses singular of one name
                        const targetClass = toPascalCase(cls.one.name);
                        const attr = pyIdentifier(cls.one.name);
                        {
                            const line = `    ${attr}: Mapped[${targetClass}] = relationship("${targetClass}", back_populates="${relAttrName(cls.many.name)}", lazy="selectin")`;
                            if (!relLineSet.has(line)) {
                                relLines.push(line);
                                relLineSet.add(line);
                            }
                        }
                    }
                } else if (cls.kind === 'one_to_one') {
                    if (cls.a.id === table.id) {
                        const targetClass = toPascalCase(cls.b.name);
                        const attr = pyIdentifier(cls.b.name);
                        {
                            const line = `    ${attr}: Mapped[${targetClass}] = relationship("${targetClass}", uselist=False, back_populates="${pyIdentifier(cls.a.name)}", lazy="selectin")`;
                            if (!relLineSet.has(line)) {
                                relLines.push(line);
                                relLineSet.add(line);
                            }
                        }
                    } else if (cls.b.id === table.id) {
                        const targetClass = toPascalCase(cls.a.name);
                        const attr = pyIdentifier(cls.a.name);
                        {
                            const line = `    ${attr}: Mapped[${targetClass}] = relationship("${targetClass}", uselist=False, back_populates="${pyIdentifier(cls.b.name)}", lazy="selectin")`;
                            if (!relLineSet.has(line)) {
                                relLines.push(line);
                                relLineSet.add(line);
                            }
                        }
                    }
                } else if (cls.kind === 'many_to_many') {
                    if (cls.a.id === table.id) {
                        const targetClass = toPascalCase(cls.b.name);
                        const assoc = m2m.find(
                            (m) => m.a.id === cls.a.id && m.b.id === cls.b.id
                        );
                        const attr = relAttrName(cls.b.name);
                        {
                            const line = `    ${attr}: Mapped[list[${targetClass}]] = relationship("${targetClass}", secondary=${assoc?.name}, back_populates="${relAttrName(cls.a.name)}", lazy="selectin")`;
                            if (!relLineSet.has(line)) {
                                relLines.push(line);
                                relLineSet.add(line);
                            }
                        }
                    } else if (cls.b.id === table.id) {
                        const targetClass = toPascalCase(cls.a.name);
                        const assoc = m2m.find(
                            (m) => m.a.id === cls.a.id && m.b.id === cls.b.id
                        );
                        const attr = relAttrName(cls.a.name);
                        {
                            const line = `    ${attr}: Mapped[list[${targetClass}]] = relationship("${targetClass}", secondary=${assoc?.name}, back_populates="${relAttrName(cls.b.name)}", lazy="selectin")`;
                            if (!relLineSet.has(line)) {
                                relLines.push(line);
                                relLineSet.add(line);
                            }
                        }
                    }
                }
            });

            const doc = (table.comments || '')
                .replace(/\r?\n/g, ' ')
                .replace(/"""/g, '\\"""');
            const comments = table.comments
                ? `\n    __doc__ = """${doc}"""`
                : '';

            // Build __table_args__: schema + constraints + indexes
            const tableArgs: string[] = [];
            // Composite PK
            if (isCompositePK) {
                const cols = pkFields.map((f) => `"${f.name}"`).join(', ');
                tableArgs.push(`sa.PrimaryKeyConstraint(${cols})`);
            }
            // Unique / Indexes
            const nonPKIndexes = table.indexes.filter(
                (idx) => !idx.isPrimaryKey
            );
            nonPKIndexes.forEach((idx) => {
                const indexFields = idx.fieldIds
                    .map((fid) => table.fields.find((f) => f.id === fid))
                    .filter((f): f is DBField => Boolean(f));
                if (indexFields.length === 0) return;
                const cols = indexFields.map((f) => `"${f.name}"`).join(', ');
                // Skip index if it duplicates the exact PK set
                const idxFieldSet = new Set(indexFields.map((f) => f.name));
                const pkFieldSet = new Set(pkFields.map((f) => f.name));
                const duplicatesPK =
                    idxFieldSet.size === pkFieldSet.size &&
                    [...idxFieldSet].every((n) => pkFieldSet.has(n));
                if (duplicatesPK) return;

                if (idx.unique) {
                    // Skip unique constraint if it's a single-column and the column already has unique=True
                    if (indexFields.length === 1 && indexFields[0].unique) {
                        return;
                    }
                    tableArgs.push(
                        `sa.UniqueConstraint(${cols}, name="${idx.name}")`
                    );
                } else {
                    tableArgs.push(`sa.Index("${idx.name}", ${cols})`);
                }
            });

            if (schemaName) {
                tableArgs.push(`{"schema": "${schemaName}"}`);
            }

            const tableArgsLine = tableArgs.length
                ? `    __table_args__ = (${tableArgs.join(', ')},)`
                : undefined;

            return [
                `class ${className}(Base):`,
                `    __tablename__ = "${table.name}"`,
                tableArgsLine,
                comments || undefined,
                cols,
                relLines.length ? relLines.join('\n') : undefined,
                '',
            ]
                .filter(Boolean)
                .join('\n');
        })
        .join('\n\n');

    // Build dialect-specific import lines AFTER scanning columns (classBlocks)
    const importLines: string[] = [...baseImportLines];
    const pgSymbols = Array.from(dialectSymbols.postgres).sort();
    if (pgSymbols.length) {
        importLines.push(
            `from sqlalchemy.dialects.postgresql import ${pgSymbols.join(', ')}`
        );
    }
    const mysqlSymbols = Array.from(dialectSymbols.mysql).sort();
    if (mysqlSymbols.length) {
        importLines.push(
            `from sqlalchemy.dialects.mysql import ${mysqlSymbols.join(', ')}`
        );
    }
    const mssqlSymbols = Array.from(dialectSymbols.mssql).sort();
    if (mssqlSymbols.length) {
        importLines.push(
            `from sqlalchemy.dialects.mssql import ${mssqlSymbols.join(', ')}`
        );
    }

    const imports = importLines.join('\n');
    const header = `${imports}\n\n\nclass Base(DeclarativeBase):\n    pass\n`;

    const footer = '\n';

    return [header, assocBlocks, classBlocks, footer]
        .filter(Boolean)
        .join('\n');
}
