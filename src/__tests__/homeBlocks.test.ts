import { describe, expect, it } from "vitest";
import { newBlock, summarize } from "@/components/admin/home/blocks";

describe("categories home block", () => {
  it("starts visible, untitled and showing every category", () => {
    const block = newBlock("categories");
    expect(block).toMatchObject({ type: "categories", hidden: false, title: "", categoryIds: [] });
  });

  it("summarizes an empty selection as all categories", () => {
    expect(summarize(newBlock("categories"))).toEqual({ text: "ทุกหมวด" });
  });

  it("summarizes a selection by count", () => {
    const block = { ...newBlock("categories"), categoryIds: [3, 5] } as ReturnType<typeof newBlock>;
    expect(summarize(block)).toEqual({ text: "2 หมวด" });
  });
});
