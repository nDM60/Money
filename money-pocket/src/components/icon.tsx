import {
  Wallet, Landmark, PiggyBank, TrendingUp, Smartphone, CreditCard, HandCoins, Shield, Utensils, Plane, Beer, ShoppingBasket, Circle,
  Bus, Fuel, Home, Zap, ShoppingBag, Dumbbell, HeartPulse, GraduationCap, Repeat, Users, Gift, Sparkles, Receipt, Briefcase, Award,
  Laptop, Store, Percent, Coins, Undo2, type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  wallet: Wallet, landmark: Landmark, "piggy-bank": PiggyBank, "trending-up": TrendingUp, smartphone: Smartphone, "credit-card": CreditCard,
  "hand-coins": HandCoins, shield: Shield, utensils: Utensils, plane: Plane, beer: Beer, "shopping-basket": ShoppingBasket, circle: Circle,
  bus: Bus, fuel: Fuel, home: Home, zap: Zap, "shopping-bag": ShoppingBag, dumbbell: Dumbbell, "heart-pulse": HeartPulse,
  "graduation-cap": GraduationCap, repeat: Repeat, users: Users, gift: Gift, sparkles: Sparkles, receipt: Receipt, briefcase: Briefcase,
  award: Award, laptop: Laptop, store: Store, percent: Percent, coins: Coins, "undo-2": Undo2,
};

export const ICON_NAMES = Object.keys(MAP);

export function Icon({ name, className, size = 18 }: { name: string; className?: string; size?: number }) {
  const C = MAP[name] ?? Circle;
  return <C className={className} size={size} strokeWidth={2} aria-hidden />;
}

/** Rounded tile with a tinted background in the entity's color. */
export function IconTile({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
    >
      <Icon name={name} size={Math.round(size * 0.48)} />
    </span>
  );
}
