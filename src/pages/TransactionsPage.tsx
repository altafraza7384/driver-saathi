import { useI18n } from "@/lib/i18n";

export default function TransactionsPage() {
  const { t } = useI18n();
  return (
    <div className="p-4 pt-6">
      <h1 className="text-2xl font-bold">{t("nav.transactions")}</h1>
      <p className="mt-2 text-muted-foreground">Coming soon...</p>
    </div>
  );
}
