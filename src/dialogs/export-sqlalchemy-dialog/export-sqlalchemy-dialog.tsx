import { Button } from '@/components/button/button';
import { CodeSnippet } from '@/components/code-snippet/code-snippet';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogInternalContent,
    DialogTitle,
} from '@/components/dialog/dialog';
import { Label } from '@/components/label/label';
import { Spinner } from '@/components/spinner/spinner';
import { useChartDB } from '@/hooks/use-chartdb';
import { useDialog } from '@/hooks/use-dialog';
import React, { useCallback, useEffect } from 'react';
import type { BaseDialogProps } from '../common/base-dialog-props';
import { exportSQLAlchemy } from '@/lib/data/code-export/sqlalchemy-export';

export interface ExportSQLAlchemyDialogProps extends BaseDialogProps {}

export const ExportSQLAlchemyDialog: React.FC<ExportSQLAlchemyDialogProps> = ({
    dialog,
}) => {
    const { closeExportSQLAlchemyDialog } = useDialog();
    const { currentDiagram } = useChartDB();

    const [code, setCode] = React.useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = React.useState<boolean>(false);

    const generate = useCallback(async () => {
        setIsLoading(true);
        try {
            const content = exportSQLAlchemy(currentDiagram);
            setCode(content);
        } finally {
            setIsLoading(false);
        }
    }, [currentDiagram]);

    useEffect(() => {
        if (!dialog.open) return;
        setCode(undefined);
        void generate();
    }, [dialog.open, generate]);

    return (
        <Dialog
            {...dialog}
            onOpenChange={(open) => {
                if (!open) {
                    closeExportSQLAlchemyDialog();
                }
            }}
        >
            <DialogContent
                className="flex max-h-screen flex-col overflow-y-auto xl:min-w-[75vw]"
                showClose
            >
                <DialogHeader>
                    <DialogTitle>Export SQLAlchemy Models</DialogTitle>
                    <DialogDescription>
                        Generate Python SQLAlchemy ORM models (Declarative Base)
                        with relationships for your diagram.
                    </DialogDescription>
                </DialogHeader>
                <DialogInternalContent>
                    <div className="flex flex-1 items-center justify-center">
                        {code === undefined ? (
                            <div className="flex flex-col items-center gap-2">
                                <Spinner />
                                <Label className="text-sm">
                                    Preparing SQLAlchemy models…
                                </Label>
                            </div>
                        ) : code.length === 0 ? (
                            <Label className="text-sm">
                                No content to export.
                            </Label>
                        ) : (
                            <CodeSnippet
                                className="h-96 w-full"
                                code={code}
                                autoScroll={true}
                                isComplete={!isLoading}
                            />
                        )}
                    </div>
                </DialogInternalContent>
                <DialogFooter className="flex !justify-between gap-2">
                    <div />
                    <DialogClose asChild>
                        <Button type="button" variant="secondary">
                            Close
                        </Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
