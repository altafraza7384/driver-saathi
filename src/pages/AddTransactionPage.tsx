import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES } from "./TransactionsPage";

const PLATFORMS = ["Ola", "Uber", "Rapido", "BluSmart", "Namma Yatri", "Other"];

export default function AddTransactionPage() {
  const [searchParams] = useSearchParams();
  const type = searchParams.get("type") === "expense" ? "expense" : "income";
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [platform, setPlatform] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);

  const categories = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !amount || !category) return;
    setLoading(true);

    const { error } = await supabase.from("transactions").insert({
      user_id: user.id,
      type,
      amount: parseFloat(amount),
      category,
      platform: platform || null,
      description: description || null,
      transaction_date: date,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: type === "income" ? "Income added!" : "Expense added!" });
      navigate("/transactions");
    }
    setLoading(false);
  };

  return (
    <div className="p-4 pt-6">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <Card>
        <CardHeader>
          <CardTitle className={type === "income" ? "text-success" : "text-destructive"}>
            {type === "income" ? t("home.addIncome") : t("home.addExpense")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Amount (₹)</Label>
              <Input
                type="number"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="text-2xl font-bold"
                min="1"
                step="0.01"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory} required>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {type === "income" && (
              <div className="space-y-2">
                <Label>Platform</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger><SelectValue placeholder="Select platform (optional)" /></SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>

            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Input
                placeholder="Add a note..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <Button
              type="submit"
              className={`w-full ${type === "income" ? "bg-success hover:bg-success/90" : ""}`}
              disabled={loading}
            >
              {loading ? "Saving..." : type === "income" ? "Add Income" : "Add Expense"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
