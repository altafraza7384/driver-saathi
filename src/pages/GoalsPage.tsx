import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatINR } from "@/lib/currency";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Plus, ArrowLeft, Target, Trash2, PartyPopper } from "lucide-react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Goal = {
  id: string;
  title: string;
  target_amount: number;
  saved_amount: number;
  deadline: string | null;
  is_completed: boolean;
};

export default function GoalsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddSavings, setShowAddSavings] = useState<string | null>(null);
  const [addAmount, setAddAmount] = useState("");

  // Add form
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) fetchGoals();
  }, [user]);

  const fetchGoals = async () => {
    const { data } = await supabase.from("goals").select("*").order("created_at", { ascending: false });
    setGoals((data as Goal[]) || []);
    setLoading(false);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    const { error } = await supabase.from("goals").insert({
      user_id: user.id,
      title,
      target_amount: parseFloat(target),
      deadline: deadline || null,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Goal created! 🎯" });
      setShowAdd(false);
      setTitle(""); setTarget(""); setDeadline("");
      fetchGoals();
    }
    setSaving(false);
  };

  const handleAddSavings = async (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    if (!goal || !addAmount) return;

    const newSaved = Number(goal.saved_amount) + parseFloat(addAmount);
    const isCompleted = newSaved >= Number(goal.target_amount);

    await supabase.from("goals").update({
      saved_amount: newSaved,
      is_completed: isCompleted,
    }).eq("id", goalId);

    if (isCompleted) {
      toast({ title: "🎉 Goal Completed!", description: `You've reached your target for "${goal.title}"!` });
    } else {
      toast({ title: `₹${addAmount} added to savings!` });
    }

    setShowAddSavings(null);
    setAddAmount("");
    fetchGoals();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("goals").delete().eq("id", id);
    fetchGoals();
  };

  return (
    <div className="space-y-4 p-4 pt-6">
      <button onClick={() => navigate("/more")} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Goals & Savings</h1>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> New Goal</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Savings Goal</DialogTitle></DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-2">
                <Label>Goal Title</Label>
                <Input placeholder="e.g. New Tires" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Target Amount (₹)</Label>
                <Input type="number" placeholder="50000" value={target} onChange={(e) => setTarget(e.target.value)} min="1" required />
              </div>
              <div className="space-y-2">
                <Label>Deadline (optional)</Label>
                <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "Creating..." : "Create Goal"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : goals.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">No goals yet. Start saving!</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {goals.map((goal, i) => {
            const progress = Number(goal.target_amount) > 0
              ? Math.min((Number(goal.saved_amount) / Number(goal.target_amount)) * 100, 100)
              : 0;
            return (
              <motion.div key={goal.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className={goal.is_completed ? "border-success/30 bg-success/5" : ""}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {goal.is_completed ? (
                          <PartyPopper className="h-5 w-5 text-success" />
                        ) : (
                          <Target className="h-5 w-5 text-primary" />
                        )}
                        <div>
                          <p className="font-semibold text-sm">{goal.title}</p>
                          {goal.deadline && (
                            <p className="text-xs text-muted-foreground">
                              By {format(new Date(goal.deadline), "dd MMM yyyy")}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(goal.id)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Saved: {formatINR(Number(goal.saved_amount))}</span>
                      <span>Target: {formatINR(Number(goal.target_amount))}</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                    <p className="text-xs font-medium text-center">{Math.round(progress)}% complete</p>

                    {!goal.is_completed && (
                      <>
                        {showAddSavings === goal.id ? (
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              placeholder="Amount"
                              value={addAmount}
                              onChange={(e) => setAddAmount(e.target.value)}
                              min="1"
                              className="flex-1"
                            />
                            <Button size="sm" onClick={() => handleAddSavings(goal.id)}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => { setShowAddSavings(null); setAddAmount(""); }}>✕</Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" className="w-full" onClick={() => setShowAddSavings(goal.id)}>
                            <Plus className="h-4 w-4 mr-1" /> Add Savings
                          </Button>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
