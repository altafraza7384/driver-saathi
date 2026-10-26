import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CreditCard, Check, Tag, Flame, Timer } from "lucide-react";
import { formatINR } from "@/lib/currency";
import { useI18n } from "@/lib/i18n";

type Offer = {
  id: string;
  title: string;
  discount_percent: number;
  plan_id: string | null;
  valid_until: string | null;
};

type Plan = {
  id: string;
  name: string;
  price_inr: number;
  billing_interval: string;
  description?: string | null;
  features?: string[] | null;
  mrp_inr?: number | null;
};

// Launch offer terms approved by the owner (2026-10-26):
// 7-day free trial on every plan; Monthly MRP Rs 199 -> Rs 99/mo,
// Yearly MRP Rs 1188 -> Rs 999/yr. MRP lives here (not in the plan docs)
// because the admin plan form has no MRP field; a plan doc's mrp_inr,
// when present, wins over the per-interval default below. The live price
// always comes from the plan doc, so an admin price edit flows through.
const TRIAL_DAYS = 7;
const DEFAULT_MRP: Record<string, number> = { monthly: 199, yearly: 1188 };

// An offer is live when it has no expiry or its valid_until is today or later.
function isOfferLive(o: Offer, today: string) {
  return !o.valid_until || o.valid_until >= today;
}

// Live countdown to tonight's midnight (local time). The "valid only
// today" offer genuinely ends at midnight; the next day a fresh countdown
// starts only if the offer is still live (see the admin Offers/plans data).
function useCountdownToMidnight() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diff = Math.max(0, midnight.getTime() - now.getTime());
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(diff / 3600000))}:${pad(Math.floor((diff % 3600000) / 60000))}:${pad(Math.floor((diff % 60000) / 1000))}`;
}

export function SubscriptionPlansCard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [selected, setSelected] = useState<Plan | null>(null);
  const countdown = useCountdownToMidnight();
  const { data: plans = [], isLoading, error: plansError } = useQuery({
    queryKey: ["subscription_plans"],
    queryFn: async () => {
      const { data, error } = await db.from("subscription_plans").select("*").eq("is_active", true).order("sort_order");
      if (error) throw error;
      return data as Plan[];
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

  // The current user's plan: users/{uid}.subscription_plan_id is null when
  // the user has no plan (see AdminUsersPage). Fail-open for marketing:
  // if the profile cannot be read, the "Only for You" badge still shows —
  // a subscriber seeing an offer badge is harmless, a non-subscriber
  // missing one loses a sale.
  const { data: myPlan } = useQuery({
    queryKey: ["plans_my_plan"],
    queryFn: async () => {
      try {
        const { data } = await db.from("users").select("*").eq("id", user!.id);
        const row = Array.isArray(data) ? data[0] : data;
        return (row as { subscription_plan_id?: string | null } | null)?.subscription_plan_id ?? null;
      } catch {
        return null;
      }
    },
    enabled: !!user,
  });
  const isNonSubscriber = !myPlan;

  const today = new Date().toISOString().slice(0, 10);
  const liveOffers = offers.filter((o) => isOfferLive(o, today));
  const offersForPlan = (planId: string) => liveOffers.filter((o) => o.plan_id === planId);
  const mrpFor = (p: Plan) => p.mrp_inr ?? DEFAULT_MRP[p.billing_interval] ?? null;
  const perFor = (p: Plan) => (p.billing_interval === "yearly" ? "yr" : "mo");
  // Per-day cost, so the amount feels small: monthly spread over 30 days,
  // yearly over 365 days (Rs 99/mo = Rs 3.30/day, Rs 999/yr = Rs 2.74/day).
  const perDayFor = (p: Plan) => {
    const days = p.billing_interval === "yearly" ? 365 : 30;
    return `₹${(Number(p.price_inr) / days).toFixed(2)}`;
  };

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
      ) : plansError ? (
        <div className="space-y-1">
          <p className="text-sm text-destructive">{t("home.loadError")}</p>
          <p className="text-xs text-muted-foreground break-words">{plansError instanceof Error ? plansError.message : String(plansError)}</p>
        </div>
      ) : plans.length === 0 ? (
        <p className="text-muted-foreground">{t("plans.noPlans")}</p>
      ) : (
        plans.map((p) => {
          const price = Number(p.price_inr);
          const mrp = mrpFor(p);
          const per = perFor(p);
          return (
            <div key={p.id} onClick={() => setSelected(p)} className="cursor-pointer rounded-lg border border-border p-3 hover:border-primary/50">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-bold">{p.name}</p>
                <div className="text-right whitespace-nowrap">
                  {mrp !== null && mrp > price && (
                    <p className="text-xs text-muted-foreground line-through">MRP {formatINR(mrp)}</p>
                  )}
                  <p className="font-bold">
                    {price === 0 ? "₹0" : `${formatINR(price)}/${per}`}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{p.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">✨ {t("plans.trialBadge", { days: TRIAL_DAYS })}</span>
                {isNonSubscriber && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">🔥 {t("plans.onlyForYou")}</span>
                )}
              </div>
              {price > 0 && (
                <p className="mt-1 text-sm font-semibold text-primary">{t("plans.perDay", { price: perDayFor(p) })}</p>
              )}
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
          );
        })
      )}
      <p className="text-xs text-muted-foreground">{t("plans.comingSoon")}</p>

      {/* Offer poster popup: opens when a plan is tapped. Poster-style card
          with the struck MRP, the offer price, the free trial, and a live
          countdown to tonight's midnight ("valid only today"). The trial
          button stays disabled until payments go live — tapping it must
          never fake a purchase. */}
      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-sm overflow-hidden p-0">
          {selected && (() => {
            const price = Number(selected.price_inr);
            const mrp = mrpFor(selected);
            const per = perFor(selected);
            return (
              <div>
                <DialogTitle className="sr-only">{selected.name}</DialogTitle>
                <div className="bg-gradient-to-r from-amber-500 to-yellow-400 px-5 py-4 text-center">
                  <p className="text-2xl">🎉</p>
                  <p className="text-lg font-extrabold text-amber-950">{t("plans.currentOffers")}</p>
                  {isNonSubscriber && (
                    <p className="text-sm font-bold text-amber-950">🔥 {t("plans.onlyForYou")}</p>
                  )}
                </div>
                <div className="space-y-3 p-5 text-center">
                  <p className="text-lg font-bold">{selected.name}</p>
                  <p>
                    {mrp !== null && mrp > price && (
                      <span className="mr-2 text-muted-foreground line-through">MRP {formatINR(mrp)}</span>
                    )}
                    <span className="text-3xl font-extrabold">{price === 0 ? "₹0" : `${formatINR(price)}/${per}`}</span>
                  </p>
                  {price > 0 && (
                    <p className="text-base font-bold text-primary">{t("plans.perDay", { price: perDayFor(selected) })}</p>
                  )}
                  <p>
                    <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-bold text-green-800">✨ {t("plans.trialBadge", { days: TRIAL_DAYS })}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("plans.thenAfterTrial", { price: formatINR(price), per })}
                  </p>
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="flex items-center justify-center gap-1 font-bold text-red-600"><Timer className="h-4 w-4" /> {t("plans.validOnlyToday")}</p>
                    <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-red-600">{countdown}</p>
                    <p className="text-xs text-muted-foreground">{t("plans.endsTonight")}</p>
                  </div>
                  <Button disabled className="w-full">
                    <Flame className="mr-2 h-4 w-4" /> {t("plans.startTrial", { days: TRIAL_DAYS })}
                  </Button>
                  <p className="text-xs text-muted-foreground">{t("plans.comingSoon")}</p>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </CardContent></Card>
  );
}
