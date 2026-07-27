import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  tone?: "default" | "error";
};

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  tone = "default",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center",
        tone === "error"
          ? "border-destructive/40 bg-destructive/5"
          : "border-border bg-muted/40",
        className,
      )}
    >
      {icon ? (
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full",
            tone === "error"
              ? "bg-destructive/10 text-destructive"
              : "bg-surface-active text-muted-foreground",
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p
          className={cn(
            "text-sm font-medium",
            tone === "error" ? "text-destructive" : "text-foreground",
          )}
        >
          {title}
        </p>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
