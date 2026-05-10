/**
 * Budget Limiter — Presupuesto máximo por sesión.
 *
 * Comandos:
 *   /budget set <monto>    Establecer límite en USD (ej: /budget set 2)
 *   /budget status         Ver gasto actual vs presupuesto
 *   /budget disable        Desactivar el límite
 *
 * Al alcanzar el presupuesto, pregunta si quieres continuar.
 * El límite se persiste en la sesión y sobrevive reinicios.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STORAGE_KEY = "budget-limiter";

let limit: number | null = null;

// ─── Suma el costo real de TODAS las entradas de la sesión ────────────────

function getSpent(ctx: ExtensionContext): number {
	let total = 0;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			total += (entry.message as AssistantMessage).usage.cost.total;
		}
	}
	return total;
}

function fmt(n: number): string {
	return `$${n.toFixed(4)}`;
}

// ─── Actualiza el footer ───────────────────────────────────────────────────

function updateFooter(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;

	if (limit === null) {
		ctx.ui.setStatus("budget", undefined);
		return;
	}

	const spent = getSpent(ctx);
	const remaining = Math.max(0, limit - spent);

	if (spent >= limit) {
		ctx.ui.setStatus(
			"budget",
			ctx.ui.theme.fg("warning", `⚠ Presupuesto agotado (${fmt(spent)})`),
		);
	} else {
		ctx.ui.setStatus(
			"budget",
			ctx.ui.theme.fg("dim", `💰 ${fmt(remaining)} restante de ${fmt(limit)}`),
		);
	}
}

// ─── Persistencia simple ───────────────────────────────────────────────────

function save(pi: ExtensionAPI): void {
	pi.appendEntry(STORAGE_KEY, { limit });
}

function restore(ctx: ExtensionContext): void {
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "custom" && entry.customType === STORAGE_KEY) {
			limit = (entry.data as { limit: number | null }).limit;
			return;
		}
	}
	limit = null;
}

// ─── Extensión ─────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

	pi.on("session_start", (_event, ctx) => {
		restore(ctx);
		updateFooter(ctx);
	});

	pi.on("agent_end", (_event, ctx) => {
		updateFooter(ctx);
	});

	// ── Preguntar si se excedió el presupuesto ─────────────────────────

	pi.on("input", async (event, ctx) => {
		if (limit === null) return { action: "continue" as const };

		const spent = getSpent(ctx);
		if (spent < limit) return { action: "continue" as const };

		// Se excedió: preguntar
		const ok = await ctx.ui.confirm(
			"Presupuesto agotado",
			[
				`Has gastado ${fmt(spent)} de un presupuesto de ${fmt(limit)}.`,
				"",
				"¿Quieres continuar de todos modos?",
			].join("\n"),
		);

		if (!ok) {
			ctx.ui.notify("Llamada cancelada por presupuesto", "warning");
			return { action: "handled" as const };
		}

		// El usuario decidió continuar — avisar y dejar pasar
		ctx.ui.notify(
			`Continuando sin presupuesto. Gasto actual: ${fmt(spent)}`,
			"info",
		);
		return { action: "continue" as const };
	});

	// ── Comando /budget ────────────────────────────────────────────────

	pi.registerCommand("budget", {
		description: "Gestionar presupuesto de la sesión",
		getArgumentCompletions: (prefix: string) => {
			const subs = ["set", "status", "disable"];
			const hits = subs.filter((s) => s.startsWith(prefix));
			return hits.length > 0 ? hits.map((s) => ({ value: s, label: s })) : null;
		},
		handler: async (args, ctx) => {
			const [sub, ...rest] = args.trim().split(/\s+/);

			if (sub === "set") {
				const amount = parseFloat(rest[0]);
				if (isNaN(amount) || amount <= 0) {
					ctx.ui.notify("Uso: /budget set <monto_en_USD>", "error");
					return;
				}

				limit = amount;
				save(pi);
				updateFooter(ctx);

				const spent = getSpent(ctx);
				const remaining = Math.max(0, amount - spent);
				ctx.ui.notify(
					`Presupuesto: ${fmt(amount)} | Gastado: ${fmt(spent)} | Restante: ${fmt(remaining)}`,
					"success",
				);
				return;
			}

			if (sub === "status") {
				const spent = getSpent(ctx);
				if (limit !== null) {
					const remaining = Math.max(0, limit - spent);
					const pct = limit > 0 ? ((spent / limit) * 100).toFixed(1) : "0.0";
					ctx.ui.notify(
						`Presupuesto: ${fmt(limit)}\nGastado:    ${fmt(spent)} (${pct}%)\nRestante:   ${fmt(remaining)}`,
						"info",
					);
				} else {
					ctx.ui.notify(
						`Sin presupuesto. Gasto actual: ${fmt(spent)}\nUsa /budget set <monto> para establecer uno.`,
						"info",
					);
				}
				return;
			}

			if (sub === "disable") {
				limit = null;
				save(pi);
				updateFooter(ctx);
				ctx.ui.notify("Presupuesto desactivado", "success");
				return;
			}

			ctx.ui.notify(
				"/budget set <monto>  — establecer límite\n/budget status       — ver estado\n/budget disable      — desactivar",
				"info",
			);
		},
	});
}
