import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./lib";

const buttonStyles = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:pointer-events-none disabled:opacity-50", {
  variants: { variant: { default: "bg-zinc-100 text-zinc-950 hover:bg-white", secondary: "bg-zinc-800 text-zinc-100 hover:bg-zinc-700", ghost: "hover:bg-zinc-800 text-zinc-300" }, size: { default: "h-9 px-4 py-2", sm: "h-8 rounded-md px-3 text-xs", icon: "h-9 w-9" } },
  defaultVariants: { variant: "default", size: "default" }
});
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles> & { asChild?: boolean };
export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) { const Comp = asChild ? Slot : "button"; return <Comp className={cn(buttonStyles({ variant, size }), className)} {...props} />; }
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("rounded-xl border border-zinc-800 bg-zinc-950/70 text-zinc-50 shadow-sm", className)} {...props} />; }
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("flex flex-col gap-1.5 p-5", className)} {...props} />; }
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) { return <h2 className={cn("font-semibold leading-none tracking-tight", className)} {...props} />; }
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) { return <p className={cn("text-sm text-zinc-400", className)} {...props} />; }
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("p-5 pt-0", className)} {...props} />; }
export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) { return <span className={cn("inline-flex items-center rounded-full border border-zinc-700 px-2.5 py-0.5 text-xs font-medium text-zinc-300", className)} {...props} />; }
export function Progress({ value, className }: { value: number; className?: string }) { return <div className={cn("h-2 w-full overflow-hidden rounded-full bg-zinc-800", className)}><div className="h-full rounded-full bg-zinc-100 transition-[width] duration-700" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>; }
