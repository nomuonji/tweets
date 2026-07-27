"use client";

import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { PlusIcon, TrashIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  findNextSlot,
} from "@/lib/services/schedule-slots";

/** "7:5" -> "07:05". Returns null when the value isn't a usable time. */
export function normalizeTime(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function sortTimes(times: string[]): string[] {
  return [...times].sort();
}

const PRESETS: Array<{ label: string; times: string[] }> = [
  { label: "朝 07:00", times: ["07:00"] },
  { label: "昼 12:00", times: ["12:00"] },
  { label: "夕 18:00", times: ["18:00"] },
  { label: "夜 21:00", times: ["21:00"] },
];

const INTERVAL_PRESETS = [
  { label: "3時間おき", hours: 3 },
  { label: "4時間おき", hours: 4 },
  { label: "6時間おき", hours: 6 },
  { label: "8時間おき", hours: 8 },
];

/** Evenly spaced slots across the day starting from `startHour`. */
function buildInterval(hours: number, startHour = 7): string[] {
  const times: string[] = [];
  for (let hour = startHour; hour < startHour + 24; hour += hours) {
    times.push(`${String(hour % 24).padStart(2, "0")}:00`);
  }
  return sortTimes(Array.from(new Set(times)));
}

type ScheduleEditorProps = {
  value: string[];
  onChange: (next: string[]) => void;
  /** Other accounts whose schedule can be copied in. */
  copySources?: Array<{ id: string; label: string; postSchedule: string[] }>;
  className?: string;
};

export function ScheduleEditor({
  value,
  onChange,
  copySources = [],
  className,
}: ScheduleEditorProps) {
  const [draftTime, setDraftTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  const times = useMemo(() => sortTimes(value.filter(Boolean)), [value]);

  const nextRun = useMemo(() => {
    if (times.length === 0) return null;
    return findNextSlot(
      times,
      DateTime.now().setZone(DEFAULT_SCHEDULE_TIMEZONE),
    );
  }, [times]);

  const addTimes = (incoming: string[]) => {
    const normalized = incoming
      .map(normalizeTime)
      .filter((item): item is string => item !== null);
    const merged = sortTimes(Array.from(new Set([...times, ...normalized])));
    onChange(merged);
  };

  const handleAdd = () => {
    const normalized = normalizeTime(draftTime);
    if (!normalized) {
      setError("時刻を入力してください。");
      return;
    }
    if (times.includes(normalized)) {
      setError(`${normalized} はすでに追加されています。`);
      return;
    }
    onChange(sortTimes([...times, normalized]));
    setDraftTime("");
    setError(null);
  };

  const removeTime = (time: string) => {
    onChange(times.filter((item) => item !== time));
    setError(null);
  };

  const availableCopySources = copySources.filter(
    (source) => source.postSchedule.length > 0,
  );

  return (
    <div className={cn("space-y-3", className)}>
      {/* Current slots */}
      {times.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
          投稿時刻が未設定です。自動投稿は実行されません。
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {times.map((time) => (
            <li key={time}>
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-1 pl-3 pr-1 text-sm tabular-nums">
                {time}
                <button
                  type="button"
                  onClick={() => removeTime(time)}
                  aria-label={`${time} を削除`}
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Add one */}
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[8rem]">
          <Input
            type="time"
            value={draftTime}
            aria-label="追加する時刻"
            onChange={(event) => {
              setDraftTime(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAdd();
              }
            }}
          />
        </div>
        <Button variant="outline" onClick={handleAdd} disabled={!draftTime}>
          <PlusIcon className="h-4 w-4" />
          追加
        </Button>
        {times.length > 0 ? (
          <Button
            variant="ghost"
            onClick={() => onChange([])}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <TrashIcon className="h-4 w-4" />
            全て削除
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {/* Quick add */}
      <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground">
          よく使う時刻
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => {
            const alreadyAdded = preset.times.every((time) =>
              times.includes(time),
            );
            return (
              <button
                key={preset.label}
                type="button"
                disabled={alreadyAdded}
                onClick={() => addTimes(preset.times)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  alreadyAdded
                    ? "cursor-not-allowed border-border text-muted-foreground opacity-50"
                    : "border-border text-muted-foreground hover:border-primary hover:text-primary",
                )}
              >
                {alreadyAdded ? `✓ ${preset.label}` : `+ ${preset.label}`}
              </button>
            );
          })}
        </div>

        <p className="pt-1 text-xs font-medium text-muted-foreground">
          一定間隔でまとめて設定（既存の時刻は置き換わります）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {INTERVAL_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(buildInterval(preset.hours))}
              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {availableCopySources.length > 0 ? (
          <>
            <p className="pt-1 text-xs font-medium text-muted-foreground">
              他のアカウントからコピー
            </p>
            <div className="flex flex-wrap gap-1.5">
              {availableCopySources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => onChange(sortTimes(source.postSchedule))}
                  className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  title={source.postSchedule.join(", ")}
                >
                  {source.label}（{source.postSchedule.length}件）
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        時刻は {DEFAULT_SCHEDULE_TIMEZONE} 基準です。
        {nextRun
          ? `次の投稿予定: ${nextRun.toFormat("M/d HH:mm")}`
          : "　"}
      </p>
    </div>
  );
}
