import { localToday } from "@/lib/budgets";
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
import { getTrialState } from "@/lib/trial";
import { httpsCallable } from "firebase/functions";
import { firebaseFunctions } from "@/integrations/firebase/client";

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
  const { user } = useAuth();
  const { t } = useI18n();
  const today = localToday();
  const countdown = useCountdownToMidnight();
  const { data: offers } = useQuery({
    queryKey: ["plans_offers"],
    queryFn: async () => {
      const snap = await db.collection("offers").get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Offer, "id">) })) as Offer[];
    },
    enabled: !!user,
  });
  const { data: plansRaw } = useQuery({
    queryKey: ["subscription_plans"],
    queryFn: async () => {
      const snap = await db.collection("subscription_plans").get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Plan, "id">) })) as Plan[];
    },
    enabled: !!user,
  });
  const { data: myProfile } = useQuery({
    queryKey: ["my_profile"],
    queryFn: async () => {
      if (!user) return null;
      const snap = await db.collection("profiles").doc(user.uid).get();
      return snap.exists ? (snap.data() as Record<string, unknown>) : null;
    },
    enabled: !!user,
  });
  const { data: subStatusData } = useQuery({
    queryKey: ["plans_sub_status"],
    queryFn: async () => {
      try {
        const fn = httpsCallable(firebaseFunctions, "getSubscriptionStatus");
        const res = await fn({});
        return res.data as { status: string | null; planInterval: string | null };
      } catch {
        return null;
      }
    },
    enabled: !!user,
  });
  const offersLive = (offers ?? []).filter((o) => isOfferLive(o, today));
  const plans = (plansRaw ?? []).slice().sort((a, b) => a.price_inr - b.price_inr);
  const myPlan = myProfile?.subscription_plan_id as string | undefined;
  const trialState = getTrialState(myProfile);
  const subStatus = subStatusData?.status ?? null;
  const subInterval = subStatusData?.planInterval ?? null;
  const paidInterval = myPlan ? (plans.find((p) => p.id === myPlan)?.billing_interval ?? (subStatus === "active" ? subInterval : null)) : (subStatus === "active" ? subInterval : null);
  const isSubTrial = subStatus === "authenticated";
  const isTrial = trialState.kind === "trial" || isSubTrial;
  const subPlanName = subInterval ? (plans.find((p) => p.billing_interval === subInterval)?.name ?? subInterval) : null;
  const [selected, setSelected] = useState<Plan | null>(null);
  const [paying, setPaying] = useState(false);
  const [paySuccess, setPaySuccess] = useState(false);
  const [payFailed, setPayFailed] = useState(false);
  const [testModeNote, setTestModeNote] = useState(false);

  async function startTrial(plan: Plan) {
    if (!user) return;
    setPaying(true);
    try {
      const fn = httpsCallable(firebaseFunctions, "startTrial");
      await fn({ planId: plan.id });
      setPaySuccess(true);
    } catch (e) {
      console.error("startTrial failed", e);
      setPayFailed(true);
    } finally {
      setPaying(false);
    }
  }

  async function startPayment(plan: Plan, offer?: Offer) {
    if (!user) return;
    setPaying(true);
    try {
      const fn = httpsCallable(firebaseFunctions, "createRazorpayOrder");
      const res = await fn({ planId: plan.id, offerId: offer?.id });
      const data = res.data as { orderId: string; keyId: string; amount: number; testMode?: boolean };
      if (data.testMode) setTestModeNote(true);
      const rzp = new (window as unknown as { Razorpay: new (opts: Record<string, unknown>) => { open: () => void } }).Razorpay({
        key: data.keyId,
        amount: data.amount,
        currency: "INR",
        name: "Driver Saathi",
        order_id: data.orderId,
        handler: async (resp: Record<string, string>) => {
          try {
            const verify = httpsCallable(firebaseFunctions, "verifyRazorpayPayment");
            await verify({ ...resp, planId: plan.id });
            setPaySuccess(true);
          } catch {
            setPayFailed(true);
          }
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      rzp.open();
    } catch (e) {
      console.error("startPayment failed", e);
      setPayFailed(true);
      setPaying(false);
    }
  }

  async function payWithWallet(plan: Plan, offer?: Offer) {
    if (!user) return;
    setPaying(true);
    try {
      const fn = httpsCallable(firebaseFunctions, "payWithWallet");
      await fn({ planId: plan.id, offerId: offer?.id });
      setPaySuccess(true);
    } catch (e) {
      console.error("payWithWallet failed", e);
      setPayFailed(true);
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {trialState.kind === "trial" && (
          <p className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {t("trial.daysLeft", { days: trialState.daysLeft })}
          </p>
        )}
        {offersLive.map((o) => (
          <p key={o.id} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {o.title} · {o.discount_percent}% {t("plans.off")} · {o.valid_until ? `${t("plans.validUntil")} ${o.valid_until} (${countdown})` : t("plans.noExpiry")}
          </p>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const offer = offersLive.find((o) => o.plan_id === plan.id);
          const mrp = plan.mrp_inr ?? DEFAULT_MRP[plan.billing_interval] ?? plan.price_inr;
          return (
            <Card key={plan.id} className={myPlan === plan.id ? "border-primary" : ""}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{plan.name}</h3>
                  {myPlan === plan.id && <span className="text-xs font-semibold text-primary">{t("plans.currentPlan")}</span>}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold">{formatINR(plan.price_inr)}</span>
                  {mrp > plan.price_inr && <span className="text-sm text-muted-foreground line-through">{formatINR(mrp)}</span>}
                  <span className="text-xs text-muted-foreground">/ {plan.billing_interval === "yearly" ? t("plans.year") : t("plans.month")}</span>
                </div>
                {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
                {plan.features && (
                  <ul className="space-y-1 text-sm">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary" /> {f}
                      </li>
                    ))}
                  </ul>
                )}
                {offer && (
                  <p className="flex items-center gap-1 text-xs font-semibold text-primary">
                    <Tag className="h-4 w-4" /> {offer.title} · {offer.discount_percent}% {t("plans.off")}
                  </p>
                )}
                <Button className="w-full" onClick={() => setSelected(plan)}>
                  {t("plans.viewPlan")}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) { setSelected(null); setPaySuccess(false); setPayFailed(false); setTestModeNote(false); } }}>
        <DialogContent>
          <DialogTitle>{selected?.name}</DialogTitle>
          {selected && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{selected.description}</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold">{formatINR(selected.price_inr)}</span>
                <span className="text-xs text-muted-foreground">/ {selected.billing_interval === "yearly" ? t("plans.year") : t("plans.month")}</span>
              </div>
              {selected.features && (
                <ul className="space-y-1 text-sm">
                  {selected.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" /> {f}
                    </li>
                  ))}
                </ul>
              )}
              <Button disabled={paying} onClick={() => selected && startPayment(selected, offersLive.find((o) => o.plan_id === selected.id))} className="w-full">
                <CreditCard className="mr-2 h-4 w-4" /> {t("plans.payNow")}
              </Button>
              <Button disabled={paying} variant="outline" onClick={() => selected && payWithWallet(selected, offersLive.find((o) => o.plan_id === selected.id))} className="w-full">
                {t("plans.payWithWallet")}
              </Button>
              {isTrial ? (
                <p className="text-sm font-semibold text-primary">
                  {isSubTrial && subPlanName ? t("plans.onSubTrial", { plan: subPlanName }) : trialState.kind === "trial" ? t("trial.daysLeft", { days: trialState.daysLeft }) : null}
                </p>
              ) : paidInterval ? (
                paidInterval === "monthly" && selected.billing_interval === "yearly" ? (
                  <Button disabled={paying} onClick={() => selected && startTrial(selected)} className="w-full">
                    <Flame className="mr-2 h-4 w-4" /> {t("plans.upgradeToYearly")}
                  </Button>
                ) : selected.billing_interval === paidInterval ? (
                  <p className="text-sm font-semibold text-primary">{t("plans.currentPlan")}</p>
                ) : null
              ) : (
                <Button disabled={paying} onClick={() => selected && startTrial(selected)} className="w-full">
                  <Flame className="mr-2 h-4 w-4" /> {t("plans.startTrial", { days: TRIAL_DAYS })}
                </Button>
              )}
              {testModeNote && <p className="text-xs text-muted-foreground">{t("plans.testModeNote")}</p>}
              {paySuccess && <p className="text-sm font-semibold text-primary">{t("plans.paySuccess")}</p>}
              {payFailed && <p className="text-sm font-semibold text-destructive">{t("plans.payFailed")}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
