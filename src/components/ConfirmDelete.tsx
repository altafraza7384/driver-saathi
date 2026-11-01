import { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/lib/i18n";

/**
 * Wraps a delete button so a tap asks "Delete this?" first instead of
 * deleting immediately (QA 2026-11-01: one mis-tap next to the edit icon
 * deleted a transaction with no undo). Usage:
 *
 *   <ConfirmDelete onConfirm={() => remove(id)} itemName={tx.category}>
 *     <Button aria-label={t("common.delete")}>…</Button>
 *   </ConfirmDelete>
 */
export function ConfirmDelete({
  children,
  onConfirm,
  itemName,
}: {
  children: ReactNode;
  onConfirm: () => void;
  itemName?: string | null;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent className="max-w-[92vw] sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("confirm.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {itemName ? `“${itemName}” — ` : ""}
            {t("confirm.deleteDesc")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
          >
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
