import { createFolder } from '@/db/repositories/folders';
import type { Folder } from '@/domain/models';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb } from '@/hooks/useDbQuery';

import { PromptDialog } from './PromptDialog';

interface NewFolderDialogProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: (folder: Folder) => void;
}

export function NewFolderDialog({ visible, onClose, onCreated }: NewFolderDialogProps) {
  const db = useDb();
  const { run } = useAsyncAction(async (name: string) => {
    const folder = await createFolder(db, { name });
    onCreated?.(folder);
  });

  return (
    <PromptDialog
      visible={visible}
      title="New folder"
      placeholder="e.g. School, Receipts"
      confirmLabel="Create"
      onCancel={onClose}
      onConfirm={async (name) => {
        if (await run(name)) onClose();
      }}
    />
  );
}
