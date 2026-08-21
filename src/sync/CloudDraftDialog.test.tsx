import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CloudDraftDialog,
  summarizeCloudDraftRecord,
  type CloudDraftDialogProps,
} from "./CloudDraftDialog";
import type { CloudDraftRecord } from "./cloudDraftTypes";

const makePayload = (targetPokemon: string, scenarioCount: number): string => JSON.stringify({
  schemaVersion: 1,
  savedAt: "2026-08-21T00:00:00.000Z",
  payload: {
    schemaVersion: 11,
    target: { pokemonInput: targetPokemon },
    scenarios: Array.from({ length: scenarioCount }, () => ({})),
  },
});

const makeRecord = (
  overrides: Partial<CloudDraftRecord> = {},
): CloudDraftRecord => ({
  ownerUid: "user-1",
  deviceId: "device-1",
  deviceLabel: "Windows / Chrome",
  schemaVersion: 1,
  payload: makePayload("ピカチュウ", 2),
  revision: 1,
  baseRevision: 0,
  mutationId: "mutation-1",
  updatedAt: "2026-08-21T03:04:05.000Z",
  expiresAt: "2026-09-20T03:04:05.000Z",
  deletedAt: null,
  ...overrides,
});

const renderDialog = (
  overrides: Partial<CloudDraftDialogProps> = {},
): string => renderToStaticMarkup(
  <CloudDraftDialog
    records={[
      makeRecord(),
      makeRecord({
        deviceId: "device-2",
        deviceLabel: "Android / Chrome",
        payload: makePayload("", 0),
        updatedAt: "2026-08-21T04:05:06.000Z",
        mutationId: "mutation-2",
      }),
    ]}
    currentDeviceId="device-1"
    onRefresh={() => undefined}
    onRestore={() => undefined}
    onDelete={() => undefined}
    onClose={() => undefined}
    {...overrides}
  />,
);

describe("summarizeCloudDraftRecord", () => {
  it("unwraps the serialized DraftStorageDocument and formats its summary", () => {
    const record = makeRecord();

    expect(summarizeCloudDraftRecord(record)).toEqual({
      deviceId: "device-1",
      deviceLabel: "Windows / Chrome",
      updatedAt: new Intl.DateTimeFormat("ja-JP", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(record.updatedAt)),
      targetPokemon: "ピカチュウ",
      scenarioCount: 2,
    });
  });

  it("uses the exact empty-input fallback without mutating the payload", () => {
    const payload = makePayload("  ", 0);
    const record = makeRecord({ payload });

    expect(summarizeCloudDraftRecord(record).targetPokemon).toBe("未入力");
    expect(record.payload).toBe(payload);
  });
});

describe("CloudDraftDialog", () => {
  it("renders current and other device sections with explicit row actions", () => {
    const html = renderDialog({
      statusMessage: "クラウドから2件を読み込みました。",
      errorMessage: "一部の下書きを確認できませんでした。",
    });

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain("作業中の下書き");
    expect(html).toContain(">このブラウザ</h3>");
    expect(html).toContain(">他のブラウザ</h3>");
    expect(html).toContain("Windows / Chrome");
    expect(html).toContain("Android / Chrome");
    expect(html).toContain(">ピカチュウ</dd>");
    expect(html).toContain(">未入力</dd>");
    expect(html).toContain(">2件</dd>");
    expect(html).toContain(">0件</dd>");
    expect(html).toContain(">復元</button>");
    expect(html).toContain(">削除</button>");
    expect(html).toContain(">更新</button>");
    expect(html).toContain(">閉じる</button>");
    expect(html).toContain("クラウドから2件を読み込みました。");
    expect(html).toContain('role="alert"');
    expect(html).toContain("一部の下書きを確認できませんでした。");
  });

  it("does not render tombstones as active choices", () => {
    const html = renderDialog({
      records: [
        makeRecord({ deletedAt: "2026-08-21T05:00:00.000Z" }),
        makeRecord({
          deviceId: "device-2",
          deviceLabel: "削除済み端末",
          deletedAt: "2026-08-21T05:01:00.000Z",
        }),
      ],
    });

    expect(html).not.toContain("Windows / Chrome");
    expect(html).not.toContain("削除済み端末");
    expect(html).toContain("このブラウザの下書きはありません。");
    expect(html).toContain("他のブラウザの下書きはありません。");
  });

  it("keeps current-device actions consistently unavailable when requested", () => {
    const html = renderDialog({ allowCurrentDeviceActions: false });

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>復元<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>削除<\/button>/);
    // The other device still has available actions.
    expect(html.match(/>復元<\/button>/g)).toHaveLength(2);
    expect(html.match(/>削除<\/button>/g)).toHaveLength(2);
  });

  it("keeps delete behind an explicit confirmation action", () => {
    const source = readFileSync(new URL("./CloudDraftDialog.tsx", import.meta.url), "utf8");

    expect(source).toContain("削除を確定");
    expect(source).toContain("この下書きを削除しますか？");
    expect(source).toContain("setPendingDeleteKey");
  });

  it("retains the modal isolation and keyboard behavior hooks without storage access", () => {
    const source = readFileSync(new URL("./CloudDraftDialog.tsx", import.meta.url), "utf8");

    expect(source).toContain('document.body.style.overflow = "hidden"');
    expect(source).toContain("(element as HTMLElement).inert = true");
    expect(source).toContain("aria-hidden");
    expect(source).toContain("previouslyFocusedRef.current?.focus()");
    expect(source).toContain("event.key === \"Escape\"");
    expect(source).toContain("keepFocusInside");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
  });
});
