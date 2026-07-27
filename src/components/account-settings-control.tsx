"use client";

import { useEffect, useState } from "react";
import type { AccountDoc } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ScheduleEditor } from "@/components/schedule/schedule-editor";

type AccountSettingsControlProps = {
  account: AccountDoc;
  onAccountUpdate: (accountId: string, updatedData: Partial<AccountDoc>) => void;
  /** Other accounts, so their schedule can be copied in. */
  otherAccounts?: AccountDoc[];
};

const MIN_LENGTH = 1;
const MAX_LENGTH = 240;

/** Coerce a number input to a usable value, falling back when left empty. */
function toBoundedInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, parsed));
}

export function AccountSettingsControl({
  account,
  onAccountUpdate,
  otherAccounts = [],
}: AccountSettingsControlProps) {
  const toast = useToast();

  const [concept, setConcept] = useState(account.concept ?? "");
  const [autoPostEnabled, setAutoPostEnabled] = useState(
    account.autoPostEnabled ?? false,
  );
  const [postSchedule, setPostSchedule] = useState<string[]>(
    account.postSchedule ?? [],
  );
  const [minPostLength, setMinPostLength] = useState(account.minPostLength ?? 1);
  const [maxPostLength, setMaxPostLength] = useState(
    account.maxPostLength ?? 240,
  );
  const [r18Mode, setR18Mode] = useState(account.r18Mode ?? false);
  const [isConceptExpanded, setIsConceptExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Re-seed the form whenever the active account changes.
  useEffect(() => {
    setConcept(account.concept ?? "");
    setAutoPostEnabled(account.autoPostEnabled ?? false);
    setPostSchedule(account.postSchedule ?? []);
    setMinPostLength(account.minPostLength ?? 1);
    setMaxPostLength(account.maxPostLength ?? 240);
    setR18Mode(account.r18Mode ?? false);
    setIsConceptExpanded(false);
    setIsSaving(false);
  }, [account]);

  const copySources = otherAccounts
    .filter((item) => item.id !== account.id)
    .map((item) => ({
      id: item.id,
      label: `@${item.handle}`,
      postSchedule: item.postSchedule ?? [],
    }));

  const handleSave = async () => {
    setIsSaving(true);

    // Normalise before persisting: drop empty slots, keep min <= max.
    const low = Math.min(minPostLength, maxPostLength);
    const high = Math.max(minPostLength, maxPostLength);
    const updated = {
      concept,
      autoPostEnabled,
      postSchedule: postSchedule.filter(Boolean).sort(),
      minPostLength: low,
      maxPostLength: high,
      r18Mode,
    };

    try {
      const response = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || "設定を更新できませんでした。");

      onAccountUpdate(account.id, updated);
      setMinPostLength(low);
      setMaxPostLength(high);
      toast.success("アカウント設定を保存しました。");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>アカウント設定</CardTitle>
        <CardDescription>
          @{account.handle} の投稿生成と自動投稿の動作を設定します。
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor={`concept-${account.id}`} className="text-sm font-medium">
              コンセプト
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsConceptExpanded((value) => !value)}
            >
              {isConceptExpanded ? "折りたたむ" : "広げる"}
            </Button>
          </div>
          <Textarea
            id={`concept-${account.id}`}
            value={concept}
            onChange={(event) => setConcept(event.target.value)}
            rows={isConceptExpanded ? 12 : 3}
            placeholder="例: 東京の天気とおでかけ情報を、親しみやすい口調で発信するアカウント"
          />
          <p className="text-xs text-muted-foreground">
            ここに書いた内容が、投稿生成時のプロンプトの土台になります。
          </p>
        </div>

        <div className="space-y-3">
          <Checkbox
            label="自動投稿を有効にする"
            description="下のスケジュール時刻に、下書きが自動で投稿されます。"
            checked={autoPostEnabled}
            onChange={(event) => setAutoPostEnabled(event.target.checked)}
          />
          <Checkbox
            label="R18 モード"
            description="有効にすると、投稿生成に Grok を使用します。"
            checked={r18Mode}
            onChange={(event) => setR18Mode(event.target.checked)}
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">投稿スケジュール</p>
          <ScheduleEditor
            value={postSchedule}
            onChange={setPostSchedule}
            copySources={copySources}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="最小文字数">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={MIN_LENGTH}
                max={MAX_LENGTH}
                value={minPostLength}
                onChange={(event) =>
                  setMinPostLength(toBoundedInt(event.target.value, MIN_LENGTH))
                }
              />
            )}
          </Field>
          <Field label="最大文字数">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={MIN_LENGTH}
                max={MAX_LENGTH}
                value={maxPostLength}
                onChange={(event) =>
                  setMaxPostLength(toBoundedInt(event.target.value, MAX_LENGTH))
                }
              />
            )}
          </Field>
        </div>
      </CardContent>

      <CardFooter className="justify-end">
        <Button loading={isSaving} onClick={handleSave}>
          設定を保存
        </Button>
      </CardFooter>
    </Card>
  );
}
