import { useState } from "react";
import { Plus, ListTodo, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

export function FAB() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start gap-3">
      {/* Menu items */}
      <div 
        className={cn(
          "flex flex-col gap-3 transition-all duration-300 origin-bottom-left",
          isOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-50 translate-y-10 pointer-events-none"
        )}
      >
        <Link href="/appointments">
          <Button 
            className="rounded-full shadow-lg h-12 px-4 gap-2 bg-card text-card-foreground hover:bg-accent border border-border"
          >
            <ListTodo className="h-5 w-5 text-primary" />
            <span>لیست انتظار امروز</span>
          </Button>
        </Link>
        <Link href="/payments">
          <Button 
            className="rounded-full shadow-lg h-12 px-4 gap-2 bg-card text-card-foreground hover:bg-accent border border-border"
          >
            <CreditCard className="h-5 w-5 text-primary" />
            <span>ثبت پرداختی جدید</span>
          </Button>
        </Link>
      </div>

      {/* Main button */}
      <Button 
        onClick={() => setIsOpen(!isOpen)}
        className="h-14 w-14 rounded-full shadow-xl bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center p-0"
      >
        <Plus className={cn("h-6 w-6 transition-transform duration-300", isOpen && "rotate-45")} />
      </Button>
    </div>
  );
}
