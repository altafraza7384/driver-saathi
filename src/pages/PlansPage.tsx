import { useNavigate } from "react-router-dom";
import { ArrowLeft, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubscriptionPlansCard } from "@/components/SubscriptionPlansCard";
import { useI18n } from "@/lib/i18n";

export default function PlansPage() {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <div className="space-y-5 p-4 pt-6">
      <div className="flex flex-col items-start gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold flex items-center gap-2 w-full">
          <CreditCard className="h-5 w-5" /> {t("plans.title")}
        </h1>
      </div>
      <SubscriptionPlansCard />
    </div>
  );
}
