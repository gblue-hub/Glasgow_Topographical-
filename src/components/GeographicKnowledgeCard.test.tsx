// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GeographicKnowledgeCell,
  GeographicKnowledgeSummary,
  KnowledgeArea,
} from "../domain/geographic-knowledge";
import {
  KNOWLEDGE_AREAS,
  knowledgeAreaLabels,
} from "../domain/geographic-knowledge";
import { GeographicKnowledgeCard } from "./GeographicKnowledgeCard";

afterEach(cleanup);

const cell = (
  area: KnowledgeArea,
  topicKey: string,
  topicLabel: string,
  values: Partial<GeographicKnowledgeCell> = {},
): GeographicKnowledgeCell => ({
  id: `${topicKey}:${area}`,
  area,
  areaLabel: knowledgeAreaLabels[area],
  topicKey,
  topicLabel,
  recordIds: [],
  total: 20,
  secure: 5,
  learning: 4,
  unseen: 11,
  due: 0,
  recentSlips: 0,
  securePercentage: 25,
  priorityScore: 70,
  ...values,
});

const cells = (topicKey: string, topicLabel: string) =>
  Object.fromEntries(
    KNOWLEDGE_AREAS.map((area) => [
      area,
      cell(area, topicKey, topicLabel),
    ]),
  ) as Record<KnowledgeArea, GeographicKnowledgeCell>;

const summary: GeographicKnowledgeSummary = {
  classifiedRecordCount: 1236,
  unclassifiedRecordCount: 0,
  areaTotals: cells("all", "All knowledge"),
  topics: [
    {
      key: "section:aa",
      label: "Public Houses",
      total: 80,
      cells: cells("section:aa", "Public Houses"),
    },
    {
      key: "main-roads",
      label: "Main roads",
      total: 80,
      cells: cells("main-roads", "Main roads"),
    },
  ],
  recommendation: cell("south", "section:aa", "Public Houses", {
    total: 47,
    secure: 8,
    learning: 6,
    unseen: 33,
    securePercentage: 17,
    recentSlips: 2,
  }),
};

describe("GeographicKnowledgeCard", () => {
  it("shows a granular topic and area recommendation", () => {
    render(
      <GeographicKnowledgeCard
        summary={summary}
        onOpenInsights={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: /focus next on public houses in the south/i,
      }),
    ).toBeVisible();
    expect(screen.getByText(/17% secure · 2 recent slips/i)).toBeVisible();
    expect(screen.getByText("North")).toBeVisible();
    expect(screen.getByText("City Centre")).toBeVisible();
  });

  it("opens the dedicated area insights view", async () => {
    const user = userEvent.setup();
    const onOpenInsights = vi.fn();
    render(
      <GeographicKnowledgeCard
        summary={summary}
        onOpenInsights={onOpenInsights}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /explore the knowledge map/i }),
    );
    expect(onOpenInsights).toHaveBeenCalledOnce();
  });
});
