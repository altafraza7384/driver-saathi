import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { Card, CardContent } from "@/components/ui/card";
import { CreditCard, Check, Tag } from "lucide-react";
import { formatINR } from "@/lib/currency";
import { useI18n } from "@/lib/i18n";

type Offer = {
  id: string;
  title: string;
  discount_percent: number;
  plan_id: string | null;
  valid_until: string | null;
};

// An offer is live when it has no expiry or its valid_until is today or later.
function isOfferLive(o: Offer, today: string) {
  return !o.valid_until || o.valid_until >= today;
}

export function SubscriptionPlansCard() {
  const { t } = useI18n();
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["subscription_plans"],
    queryFn: async () => {
      const { data, error } = await db.from("subscription_plans").select("*").eq("is_active", true).order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  // Fail-soft: if offers cannot load (old rules, no collection yet), the
  // plans list still renders exactly as before.
  const { data: offers = [] } = useQuery({
    queryKey: ["offers"],
    queryFn: async () => {
      try {
        const { data, error } = await db.from("offers").select("*").eq("is_active", true).order("sort_order");
        if (error) return [];
        return data as Offer[];
      } catch {
        return [];
      }
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const liveOffers = offers.filter((o) => isOfferLive(o, today));
  const offersForPlan = (planId: string) => liveOffers.filter((o) => o.plan_id === planId);

  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-muted-foreground" /><span className="font-semibold">{t("plans.title")}</span></div>
      {liveOffers.length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-1">
          <p className="flex items-center gap-1 text-sm font-bold"><Tag className="h-4 w-4" /> {t("plans.currentOffers")}</p>
          {liveOffers.map((o) => (
            <p key={o.id} className="text-sm text-muted-foreground">
              {`${o.title} — ${o.discount_percent}% off`}
            </p>
          ))}
        </div>
      )}
      {isLoading ? (
        <div className="h-16 animate-pulse rounded-md bg-muted" />
      ) : plans.length === 0 ? (
        <p className="text-muted-foreground">{t("plans.noPlans")}</p>
      ) : (
        plans.map((p) => (
          <div key={p.id} className="rounded-lg border border-border p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-bold">{p.name}</p>
              <p className="font-bold whitespace-nowrap">
                {Number(p.price_inr) === 0 ? "₹0" : `${formatINR(Number(p.price_inr))}/${p.billing_interval === "yearly" ? "yr" : "mo"}`}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">{p.description}</p>
            {offersForPlan(p.id).map((o) => (
              <p key={o.id} className="flex items-center gap-1 text-sm font-semibold text-primary">
                <Tag className="h-3 w-3" />
                {`${o.title} — ${o.discount_percent}% off`}
              </p>
            ))}
            {p.features?.length > 0 && (
              <ul className="mt-2 space-y-1">
                {p.features.map((f, i) => <li key={i} className="flex items-start gap-2 text-sm"><Check className="h-4 w-4 mt-0.5 shrink-0" />{f}</li>)}
              </ul>
            )}
          </div>
        ))
      )}
      <p className="text-xs text-muted-foreground">{t("plans.comingSoon")}</p>
    </CardContent></Card>
  );
}
