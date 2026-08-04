/**
 * Board view — single-page executive summary.
 */

import type { MetricsResult } from "../consolidation/types.js";

export interface BoardReport {
  period: { since: string; until: string };
  headline: {
    involvementRate: number;
    authorshipRate: number;
    deliveryFrequency: number;
    ctsSwProxy?: number;
  };
  trend: {
    involvementChange: number; // percentage points change first week to last week
    authorshipChange: number;
  };
  guardrails: {
    status: "healthy" | "warning" | "degraded";
    notes: string[];
  };
}

/** Shape MetricsResult into a board-level executive summary. */
export function buildBoardReport(metrics: MetricsResult): BoardReport {
  // Compute trend (first week vs last week)
  const trend = computeTrend(metrics.weeklyTrend);

  // Guardrail status — simple heuristic for the PoC
  const guardrails = assessGuardrails(metrics);

  return {
    period: metrics.period,
    headline: {
      involvementRate: metrics.summary.involvementRate,
      authorshipRate: metrics.summary.authorshipRate,
      deliveryFrequency: metrics.summary.deliveryFrequency,
      ctsSwProxy: metrics.summary.ctsSwProxy,
    },
    trend,
    guardrails,
  };
}

function computeTrend(
  weeklyTrend: MetricsResult["weeklyTrend"]
): BoardReport["trend"] {
  if (weeklyTrend.length < 2) {
    return { involvementChange: 0, authorshipChange: 0 };
  }

  const first = weeklyTrend[0]!;
  const last = weeklyTrend[weeklyTrend.length - 1]!;

  return {
    involvementChange:
      Math.round((last.involvementRate - first.involvementRate) * 10) / 10,
    authorshipChange:
      Math.round((last.authorshipRate - first.authorshipRate) * 10) / 10,
  };
}

function assessGuardrails(metrics: MetricsResult): BoardReport["guardrails"] {
  const notes: string[] = [];

  // If we have weekly trend data, check for the 10% rule
  if (metrics.weeklyTrend.length >= 2) {
    const first = metrics.weeklyTrend[0]!;
    const last = metrics.weeklyTrend[metrics.weeklyTrend.length - 1]!;

    // Check if involvement is climbing while authorship quality might be slipping
    // (In a real system, you'd check lint errors, test failures, etc.)
    if (
      last.involvementRate > first.involvementRate + 10 &&
      last.authorshipRate > first.authorshipRate + 20
    ) {
      notes.push(
        "Rapid AI authorship growth detected — verify quality metrics (lint, tests) are stable"
      );
    }
  }

  if (metrics.summary.authorshipRate > 90) {
    notes.push(
      "AI authorship rate > 90% — ensure human review practices are maintained"
    );
  }

  if (notes.length === 0) {
    notes.push("All guardrails within acceptable thresholds");
  }

  const status: BoardReport["guardrails"]["status"] =
    notes.length > 1 ? "warning" : notes[0]?.includes("acceptable") ? "healthy" : "warning";

  return { status, notes };
}
