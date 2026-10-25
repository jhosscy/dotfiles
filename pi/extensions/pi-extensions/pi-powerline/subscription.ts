/**
 * Subscription detection and optional quota data.
 *
 * pi decides "this provider is paid by a subscription" with
 * `ModelRuntime.isUsingSubscription(providerId)`, which is
 * `isUsingOAuth(providerId) && provider.auth.oauth.isSubscription === true`,
 * plus a hardcoded `kimi-coding` case in the native footer (Kimi Coding is
 * subscription-backed while using API-key auth). That is reproduced here from
 * the pieces `ctx.modelRegistry` does expose.
 *
 * Quotas are not pi data. They come from the optional `pi-sub-core` extension
 * over the event bus; when it is not installed nothing is polled or rendered.
 */
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SubscriptionUsage } from "./types.js";

export interface SubCoreUsageSnapshot extends SubscriptionUsage {
  provider: string;
}

/** Providers whose access is subscription-backed despite using API-key auth. */
const SUBSCRIPTION_PROVIDERS = new Set(["kimi-coding"]);

export function isSubscriptionModel(ctx: ExtensionContext, model: Model<any> | undefined): boolean {
  if (!model) return false;
  if (SUBSCRIPTION_PROVIDERS.has(model.provider)) return true;
  try {
    if (!ctx.modelRegistry.isUsingOAuth(model)) return false;
    return ctx.modelRegistry.getProvider(model.provider)?.auth.oauth?.isSubscription === true;
  } catch {
    return false;
  }
}

export interface SubCoreBridge {
  get(): SubCoreUsageSnapshot | undefined;
  dispose(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readUsage(payload: unknown): SubCoreUsageSnapshot | undefined {
  if (!isRecord(payload)) return undefined;
  const state = isRecord(payload.state) ? payload.state : undefined;
  if (!state) return undefined;
  // `sub-core:update-all` carries the per-provider entries; the other channels
  // carry the current provider's usage directly.
  if (Array.isArray(state.entries) && typeof state.provider === "string") {
    const entry = state.entries.find(
      (candidate) => isRecord(candidate) && candidate.provider === state.provider,
    );
    if (isRecord(entry) && isRecord(entry.usage)) return entry.usage as unknown as SubCoreUsageSnapshot;
    return undefined;
  }
  if (isRecord(state.usage)) return state.usage as unknown as SubCoreUsageSnapshot;
  return undefined;
}

export function createSubCoreBridge(pi: ExtensionAPI): SubCoreBridge {
  let usage: SubCoreUsageSnapshot | undefined;
  const off = [
    pi.events.on("sub-core:update-all", (payload) => { usage = readUsage(payload); }),
    pi.events.on("sub-core:update-current", (payload) => { usage = readUsage(payload); }),
    pi.events.on("sub-core:ready", (payload) => { usage = readUsage(payload); }),
  ];
  return {
    get: () => usage,
    dispose: () => {
      for (const unsubscribe of off) unsubscribe();
      off.length = 0;
    },
  };
}
