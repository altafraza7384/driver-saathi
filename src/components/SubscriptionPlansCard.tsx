import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { Card, CardContent } from "@/components/ui/card";
import { CreditCard, Check } from "lucide-react";
import { formatINR } from "@/lib/currency";

export function SubscriptionPlansCard() {
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["subscription_plans"],
    queryFn: async () => {
      const { data, error } = await db.from("subscription_plans").select("*").eq("is_active", true).order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-muted-foreground" /><span className="font-semibold">Subscription Plans</span></div>
      {isLoading ? (
        <div className="h-16 animate-pulse rounded-md bg-muted" />
      ) : plans.length === 0 ? (
        <p className="text-muted-foreground">No plans available right now.</p>
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
            {p.features?.length > 0 && (
              <ul className="mt-2 space-y-1">
                {p.features.map((f, i) => <li key={i} className="flex items-start gap-2 text-sm"><Check className="h-4 w-4 mt-0.5 shrink-0" />{f}</li>)}
              </ul>
            )}
          </div>
        ))
      )}
      <p className="text-xs text-muted-foreground">Paid plans and payments are coming soon.</p>
    </CardContent></Card>
  );
}
