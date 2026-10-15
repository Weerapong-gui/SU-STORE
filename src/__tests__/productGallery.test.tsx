import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductGallery } from "@/components/store/ProductGallery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FRAME_WIDTH = 400;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(images: string[], fallback?: string) {
  act(() => root.render(<ProductGallery key={images.join("|")} images={images} alt="Shirt" fallback={fallback} />));
}

// jsdom has no layout: give the swipe track a width and a scrollTo that moves scrollLeft.
function mockTrack() {
  const track = container.querySelector<HTMLDivElement>("[data-gallery-track]")!;
  Object.defineProperty(track, "clientWidth", { configurable: true, value: FRAME_WIDTH });
  const scrollTo = vi.fn();
  track.scrollTo = scrollTo as unknown as typeof track.scrollTo;
  return { track, scrollTo };
}

function scrollTrackTo(track: HTMLDivElement, left: number) {
  act(() => {
    track.scrollLeft = left;
    track.dispatchEvent(new Event("scroll"));
  });
}

const dots = () => [...container.querySelectorAll<HTMLButtonElement>("[data-gallery-dot]")];
const currentDot = () => dots().findIndex((dot) => dot.getAttribute("aria-current") === "true");

describe("ProductGallery", () => {
  it("single image shows no controls", () => {
    render(["a.png"]);
    expect(container.querySelector('button[aria-label="Next image"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Previous image"]')).toBeNull();
    expect(dots()).toHaveLength(0);
    expect(container.textContent).not.toContain("1 / 1");
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("next button scrolls to the second image and updates the dots", () => {
    render(["a.png", "b.png", "c.png"]);
    const { track, scrollTo } = mockTrack();
    expect(currentDot()).toBe(0);
    expect(container.textContent).toContain("1 / 3");

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Next image"]')!.click());
    expect(scrollTo).toHaveBeenCalledWith({ left: FRAME_WIDTH, behavior: "smooth" });

    scrollTrackTo(track, FRAME_WIDTH);
    expect(currentDot()).toBe(1);
    expect(container.textContent).toContain("2 / 3");
  });

  it("previous button and dots scroll to their image", () => {
    render(["a.png", "b.png", "c.png"]);
    const { track, scrollTo } = mockTrack();
    act(() => dots()[2].click());
    expect(scrollTo).toHaveBeenLastCalledWith({ left: FRAME_WIDTH * 2, behavior: "smooth" });

    scrollTrackTo(track, FRAME_WIDTH * 2);
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Previous image"]')!.click());
    expect(scrollTo).toHaveBeenLastCalledWith({ left: FRAME_WIDTH, behavior: "smooth" });
  });

  it("resets to the first image when images change", () => {
    render(["a.png", "b.png", "c.png"]);
    const { track } = mockTrack();
    scrollTrackTo(track, FRAME_WIDTH * 2);
    expect(currentDot()).toBe(2);

    render(["x.png", "y.png"]);
    expect(currentDot()).toBe(0);
    expect(container.textContent).toContain("1 / 2");
  });

  it("swipe track is clipped", () => {
    render(["a.png", "b.png"]);
    const track = container.querySelector("[data-gallery-track]")!;
    expect(track.parentElement!.classList).toContain("overflow-hidden");
    expect(track.classList).toContain("snap-x");
  });

  it("shows the fallback when there is no image", () => {
    render([], "AGRO");
    expect(container.textContent).toContain("AGRO");
    expect(container.querySelector("img")).toBeNull();
    expect(dots()).toHaveLength(0);
  });
});
