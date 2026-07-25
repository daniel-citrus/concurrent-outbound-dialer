<script lang="ts">
	import { onDestroy } from "svelte";
	import type { VisualizerStore } from "$lib/store.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { cn } from "$lib/utils";
	import XIcon from "@lucide/svelte/icons/x";
	import Maximize2Icon from "@lucide/svelte/icons/maximize-2";

	let {
		store,
		onExpand,
		onClose,
	}: {
		store: VisualizerStore;
		onExpand: () => void;
		onClose: () => void;
	} = $props();

	const EDGE_MARGIN = 20;
	const DRAG_THRESHOLD = 4;

	const session = $derived(store.session);
	const snapshot = $derived(store.snapshot);

	const DIALING_STATUSES = new Set(["creating", "queued", "initiated", "ringing"]);

	const hasConnectedCall = $derived(
		store.calls.some((c) => c.status === "in_progress"),
	);
	const hasDialingCall = $derived(
		store.calls.some((c) => DIALING_STATUSES.has(c.status)),
	);

	/** green = live call, yellow = dialing, idle = neither. */
	const glow = $derived.by<"active" | "dialing" | "idle">(() => {
		if (hasConnectedCall) return "active";
		if (hasDialingCall) return "dialing";
		return "idle";
	});

	const remainingContacts = $derived(
		snapshot?.queuedContactCount ??
			store.contacts.filter((c) => !["completed", "failed", "canceled", "skipped"].includes(c.status))
				.length,
	);

	const showStart = $derived(
		!!session &&
			(session.status === "created" ||
				(session.status === "winner_selected" &&
					(snapshot?.queuedContactCount ?? 0) > 0)),
	);

	const startDisabled = $derived(
		store.busy || (snapshot?.activeCallCount ?? 0) > 0,
	);

	const canPause = $derived(session?.status === "running");
	const canResume = $derived(session?.status === "paused");
	const canStop = $derived(
		!!session && !["stopped", "completed", "failed"].includes(session.status),
	);

	let toolEl = $state<HTMLDivElement | null>(null);
	/** Position of the tool's top-left corner in viewport coords. null = default bottom-right. */
	let pos = $state<{ x: number; y: number } | null>(null);
	let dragging = $state(false);
	let snapTransition = $state(false);

	let dragPointerId: number | null = null;
	let dragOrigin = { x: 0, y: 0 };
	let posAtDragStart = { x: 0, y: 0 };
	let didDrag = false;

	function toolSize(): { w: number; h: number } {
		if (!toolEl) return { w: 280, h: 48 };
		const rect = toolEl.getBoundingClientRect();
		return { w: rect.width, h: rect.height };
	}

	function defaultPos(): { x: number; y: number } {
		const { w, h } = toolSize();
		return {
			x: window.innerWidth - w - EDGE_MARGIN,
			y: window.innerHeight - h - EDGE_MARGIN,
		};
	}

	function clampPos(x: number, y: number): { x: number; y: number } {
		const { w, h } = toolSize();
		const maxX = Math.max(EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN);
		const maxY = Math.max(EDGE_MARGIN, window.innerHeight - h - EDGE_MARGIN);
		return {
			x: Math.min(maxX, Math.max(EDGE_MARGIN, x)),
			y: Math.min(maxY, Math.max(EDGE_MARGIN, y)),
		};
	}

	/**
	 * Snap the tool to the nearest viewport edge, keeping the other axis.
	 * Compares gaps from the tool's edges (not its center) so the wide pill
	 * doesn't bias toward top/bottom on landscape screens.
	 */
	function snapToNearestEdge(x: number, y: number): { x: number; y: number } {
		const { w, h } = toolSize();
		const distLeft = x;
		const distRight = window.innerWidth - (x + w);
		const distTop = y;
		const distBottom = window.innerHeight - (y + h);
		const nearest = Math.min(distLeft, distRight, distTop, distBottom);

		let next = { x, y };
		if (nearest === distLeft) {
			next.x = EDGE_MARGIN;
		} else if (nearest === distRight) {
			next.x = window.innerWidth - w - EDGE_MARGIN;
		} else if (nearest === distTop) {
			next.y = EDGE_MARGIN;
		} else {
			next.y = window.innerHeight - h - EDGE_MARGIN;
		}
		return clampPos(next.x, next.y);
	}

	function currentPos(): { x: number; y: number } {
		return pos ?? defaultPos();
	}

	function onPointerDown(e: PointerEvent) {
		const target = e.target as HTMLElement | null;
		// Let buttons / interactive controls receive clicks without starting a drag.
		if (target?.closest?.("button, a, input, textarea, select, [role='switch']")) return;

		const start = currentPos();
		dragPointerId = e.pointerId;
		dragOrigin = { x: e.clientX, y: e.clientY };
		posAtDragStart = start;
		didDrag = false;
		dragging = false;
		snapTransition = false;

		toolEl?.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (dragPointerId !== e.pointerId) return;

		const dx = e.clientX - dragOrigin.x;
		const dy = e.clientY - dragOrigin.y;
		if (!didDrag && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

		didDrag = true;
		dragging = true;
		pos = clampPos(posAtDragStart.x + dx, posAtDragStart.y + dy);
	}

	function onPointerUp(e: PointerEvent) {
		if (dragPointerId !== e.pointerId) return;
		dragPointerId = null;
		try {
			toolEl?.releasePointerCapture(e.pointerId);
		} catch {
			/* already released */
		}

		if (!didDrag) {
			dragging = false;
			return;
		}

		dragging = false;
		snapTransition = true;
		pos = snapToNearestEdge(currentPos().x, currentPos().y);
	}

	function onWindowResize() {
		if (!pos) return;
		snapTransition = false;
		pos = snapToNearestEdge(pos.x, pos.y);
	}

	$effect(() => {
		window.addEventListener("resize", onWindowResize);
		return () => window.removeEventListener("resize", onWindowResize);
	});

	onDestroy(() => {
		dragPointerId = null;
	});

	const stylePos = $derived.by(() => {
		if (!pos) return "";
		return `left: ${pos.x}px; top: ${pos.y}px; right: auto; bottom: auto;`;
	});
</script>

{#if session}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={toolEl}
		class={cn(
			"fixed z-[10000] flex cursor-grab items-center gap-3.5 rounded-full border border-[#3a3a3a] bg-gradient-to-br from-[#1a1a1a] to-[#2d2d2d] px-3.5 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)] select-none touch-none",
			!pos && "right-5 bottom-5",
			dragging ? "cursor-grabbing transition-none" : snapTransition
				? "transition-[left,top,box-shadow,border-color] duration-300 ease-out"
				: "transition-[box-shadow,border-color] duration-300",
			glow === "active" &&
				"animate-dialer-glow-green border-emerald-500/70 shadow-[0_8px_24px_rgba(0,0,0,0.45),0_0_0_1px_rgba(16,185,129,0.5),0_0_22px_rgba(16,185,129,0.55)]",
			glow === "dialing" &&
				"animate-dialer-glow-amber border-amber-500/70 shadow-[0_8px_24px_rgba(0,0,0,0.45),0_0_0_1px_rgba(245,158,11,0.5),0_0_22px_rgba(245,158,11,0.55)]",
		)}
		style={stylePos}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
	>
		<div class="flex items-center gap-2.5">
			<span
				class={cn(
					"size-2.5 shrink-0 rounded-full bg-gray-500",
					glow === "active" && "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.9)]",
					glow === "dialing" && "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.9)]",
				)}
			></span>
			<div class="flex items-baseline gap-1 text-white">
				<span class="text-lg font-bold tabular-nums">{remainingContacts}</span>
				<span class="text-[11px] tracking-wide text-gray-400 uppercase">left</span>
			</div>
		</div>

		<div class="flex items-center gap-1.5">
			{#if showStart}
				<Button
					type="button"
					size="sm"
					disabled={startDisabled}
					title={startDisabled ? "Finish the current call before starting" : undefined}
					onclick={() => store.start()}
				>
					Start
				</Button>
			{/if}
			{#if canPause}
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={store.busy}
					onclick={() => store.pause()}
				>
					Pause
				</Button>
			{:else if canResume}
				<Button
					type="button"
					size="sm"
					disabled={store.busy}
					onclick={() => store.resume()}
				>
					Resume
				</Button>
			{/if}
			{#if canStop}
				<Button
					type="button"
					variant="destructive"
					size="sm"
					disabled={store.busy}
					onclick={() => store.stop()}
				>
					Stop
				</Button>
			{/if}
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				class="text-slate-300 hover:bg-white/12 hover:text-white"
				title="Expand visualizer"
				aria-label="Expand visualizer"
				onclick={onExpand}
			>
				<Maximize2Icon class="size-4" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				class="text-slate-300 hover:bg-red-500/20 hover:text-red-400"
				title="End session and close"
				aria-label="End session and close"
				disabled={store.busy}
				onclick={onClose}
			>
				<XIcon class="size-4" />
			</Button>
		</div>
	</div>
{/if}
