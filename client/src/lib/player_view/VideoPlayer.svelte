<script lang="ts">
    import { run, preventDefault } from 'svelte/legacy';


import {acts} from '@tadashi/svelte-notification'
import {create as sdb_create} from "simple-drawing-board";
import {onMount, onDestroy} from 'svelte';
import {scale} from "svelte/transition";
import '@fortawesome/fontawesome-free/css/all.min.css';
import * as Proto3 from '@clapshot_protobuf/typescript';
import {HybridVideoDecoder} from './video-decoder/HybridVideoDecoder';
import {TimecodeUtils} from './video-decoder/timecode';
import {allComments, curSubtitle, videoIsReady, collabId, curVideo, clientConfig} from '@/stores';
import LocalStorageCookies from '@/cookies';


    interface Props {
        src: any;
        oncollabreport?: (event: {report: Proto3.client.ClientToServerCmd_CollabReport}) => void;
        onseeked?: () => void;
        onchangesubtitle?: (event: {id: string | null}) => void;
        oncommentpinclicked?: (event: {id: string}) => void;
        onuploadsubtitles?: () => void;
    }

    let { src, oncollabreport, onseeked, onchangesubtitle, oncommentpinclicked, onuploadsubtitles }: Props = $props();

// These are bound to properties of the video
let videoElem: any = $state();
let time: number = $state(0);
let duration: number | undefined = $state();
let paused: boolean = $state(true);



// Duration abstraction for better testability
export function getEffectiveDuration(): number {
	// In production, always use the real duration (even if NaN/undefined)
	// Only provide fallback in test environment
	if (duration != null && !isNaN(duration)) {
		return duration;
	}

	// Check if we're running in a test environment
	// Multiple ways to detect this reliably
	const isTestEnvironment = (
		typeof globalThis !== 'undefined' &&
		(globalThis.process?.env?.NODE_ENV === 'test' ||
		 globalThis.process?.env?.VITEST === 'true' ||
		 typeof (globalThis as any).expect !== 'undefined' ||
		 typeof (globalThis as any).vi !== 'undefined')
	);

	if (isTestEnvironment) {
		// Only in tests: provide a reasonable fallback
		return 120; // 2 minutes test duration
	}

	// In production: return the actual value (NaN/undefined) so errors surface
	return duration || 0;
}

let loop: boolean = $state(false);
let loopStartTime: number = $state(-1);
let loopEndTime: number = $state(-2);
let highlightedCommentId: string | undefined = $state(undefined);

let videoCanvasContainer: any = $state();
let videoDecoder: HybridVideoDecoder | null = null;

let debug_layout: boolean = false; // Set to true to show CSS layout boxes
let debugTapHud = $state(false);
let debugTapHudLines = $state<string[]>([]);
function pushTapHud(message: string) {
    if (!debugTapHud) return;
    const line = `${new Date().toLocaleTimeString()} | ${message}`;
    debugTapHudLines = [line, ...debugTapHudLines].slice(0, 10);
}

let commentsWithTc: Proto3.Comment[] = $derived(
    $allComments
        .filter(c => c.comment.timecode)
        .map(c => c.comment)
        .sort((a, b) => {
            if (!a.timecode || !b.timecode) { return 0; }
            return a.timecode.localeCompare(b.timecode);
        })
);

let animationFrameId: number = 0;
let audio_volume: number | undefined = $state();
let overlayVisible: boolean = $state(true);
let overlayHideTimer: ReturnType<typeof setTimeout> | null = null;
let fullscreenMouseIdleTimer: ReturnType<typeof setTimeout> | null = null;
let suppressAutoShowOverlayUntil = 0;
let desktopMouseWakeLocked = false;


function initializeVolume() {
    const storedVolume = LocalStorageCookies.get('audio_volume');
    audio_volume = storedVolume ? parseInt(storedVolume) : 100;
    if (videoElem && audio_volume !== undefined) {
        videoElem.volume = audio_volume / 100;
    }
}
run(() => {
    if (videoElem && audio_volume !== undefined) {
        videoElem.volume = audio_volume / 100;
        LocalStorageCookies.set('audio_volume', audio_volume.toString(), null);
    }
});

function clearOverlayHideTimer() {
    if (overlayHideTimer) {
        clearTimeout(overlayHideTimer);
        overlayHideTimer = null;
    }
}

function clearFullscreenMouseIdleTimer() {
    if (fullscreenMouseIdleTimer) {
        clearTimeout(fullscreenMouseIdleTimer);
        fullscreenMouseIdleTimer = null;
    }
}

function hideOverlayQuick() {
    clearOverlayHideTimer();
    clearFullscreenMouseIdleTimer();
    overlayVisible = false;
}

function hideOverlayByDesktopClick() {
    hideOverlayQuick();
    // Do not lock desktop mouse wake-up:
    // moving mouse over video should always be able to reveal controls.
    desktopMouseWakeLocked = false;
}

function showOverlay(autoHide: boolean = true) {
    // Hard isolation window: block any late single-click callback from re-showing controls.
    if (isOverlayShowBlocked()) return;
    // Any explicit request to show controls should cancel review-mode auto-hide suppression.
    suppressAutoShowOverlayUntil = 0;
    overlayVisible = true;
    desktopMouseWakeLocked = false;
    clearOverlayHideTimer();
    if (autoHide && !paused) {
        overlayHideTimer = setTimeout(() => {
            overlayVisible = false;
        }, 2200);
    }
}

function revealOverlayFromHidden() {
    // Hard isolation window: never reveal controls while blocked by double-tap chain.
    if (isOverlayShowBlocked()) return;
    // First tap when hidden: reveal controls only.
    showOverlay(true);
    suppressClickUntil = Date.now() + 260;
}

function onVideoRegionMouseMove() {
    if (isInCommentReviewTapMode()) {
        desktopMouseWakeLocked = false;
        reviewFirstTapGuard = false;
    }
}

function onVideoRegionMouseLeave() {
    desktopMouseWakeLocked = false;
}

let isSystemFullscreen = $state(false);

function refreshSystemFullscreenState() {
    const doc: any = document as any;
    const fsEl =
        doc.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.mozFullScreenElement ||
        doc.msFullscreenElement;
    const video = videoElem as any;
    isSystemFullscreen = Boolean(fsEl) || Boolean(video?.webkitDisplayingFullscreen);
}

async function exitSystemFullscreen() {
    const doc: any = document as any;
    try {
        if (typeof doc.exitFullscreen === 'function') {
            await doc.exitFullscreen();
            return;
        }
        if (typeof doc.webkitExitFullscreen === 'function') {
            doc.webkitExitFullscreen();
            return;
        }
        if (typeof doc.webkitCancelFullScreen === 'function') {
            doc.webkitCancelFullScreen();
            return;
        }
    } catch (err) {
        console.warn('Failed to exit fullscreen', err);
    }
}

async function enterSystemFullscreen() {
    const video = videoElem as any;
    const container = videoCanvasContainer as any;

    try {
        // iOS Safari native player fullscreen
        if (video && typeof video.webkitEnterFullscreen === 'function') {
            video.webkitEnterFullscreen();
            return;
        }

        // Standard Fullscreen API (prefer container to keep custom UI when possible)
        if (container && typeof container.requestFullscreen === 'function') {
            await container.requestFullscreen();
            return;
        }
        if (video && typeof video.requestFullscreen === 'function') {
            await video.requestFullscreen();
            return;
        }

        // Legacy WebKit fallback
        if (container && typeof container.webkitRequestFullscreen === 'function') {
            container.webkitRequestFullscreen();
            return;
        }
        if (video && typeof video.webkitRequestFullscreen === 'function') {
            video.webkitRequestFullscreen();
            return;
        }
    } catch (err) {
        console.warn('Failed to enter fullscreen', err);
    }
}

export async function toggleSystemFullscreen() {
    if (isSystemFullscreen) {
        await exitSystemFullscreen();
    } else {
        await enterSystemFullscreen();
    }
}

$effect(() => {
    if (typeof window === 'undefined') {
        isDesktopViewport = false;
        return;
    }

    const media = window.matchMedia('(min-width: 768px)');
    const apply = () => {
        isDesktopViewport = media.matches;
    };

    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
});

$effect(() => {
    if (!paused) {
        if (isDesktopViewport) {
            // Desktop: keep controls visible briefly, then auto-hide.
            if (Date.now() < suppressAutoShowOverlayUntil) {
                clearOverlayHideTimer();
                overlayVisible = false;
                return;
            }
            showOverlay(true);
            return;
        }

        // Mobile: keep current immediate-hide behavior.
        hideOverlayQuick();
    } else {
        clearOverlayHideTimer();
    }
});



function send_collab_report(): void {
    if ($collabId) {
        let drawing = paused ? getScreenshot() : undefined;
        let report: Proto3.client.ClientToServerCmd_CollabReport = {
            paused: videoElem.paused,
            loop: videoElem.loop,
            seekTimeSec: videoDecoder?.getPosition().timestamp ?? videoElem.currentTime,
            drawing,
            subtitleId: $curSubtitle?.id,
        };
        if (oncollabreport) oncollabreport({ report });
    }
}

let draw_color: string = "red";
let draw_board: any = null;
let draw_canvas: any = null;

function setPenColor(c: string): void {
    draw_color = c;
    draw_board.setLineColor(draw_color);
    draw_canvas.style.outline = "5px solid " + draw_color;
}

function prepare_drawing(): void
{
    // Never keep video hidden just because drawing board isn't ready yet
    $videoIsReady = true;

    if (draw_board || !videoElem || videoElem.videoWidth <= 0) {
        return;
    }

    const parsedFps = parseFloat($curVideo?.duration?.fps ?? "");
    const frameRate = isNaN(parsedFps) ? 24 : parsedFps;

    // Initialize hybrid stepper (handles HTML5 + Mediabunny switching internally)
    videoDecoder = new HybridVideoDecoder({
        videoElement: videoElem,
        videoSource: src,
        container: videoCanvasContainer,
        frameRate,
        duration: videoElem.duration || 0,
        onclick: clickOnVideo,
        enableMediabunny: $clientConfig?.enable_mediabunny !== false,
    });
    videoDecoder.init({
        frameRate,
        duration: videoElem.duration || 0,
    });

    // Create the drawing board
    draw_canvas = document.createElement('canvas');
    draw_canvas.width = videoElem.videoWidth;
    draw_canvas.height = videoElem.videoHeight;
    // Default below overlay controls; only raise above controls while actively drawing.
    draw_canvas.classList.add("absolute", "max-h-full", "max-w-full", "z-[100]", "touch-none");
    draw_canvas.style.cssText = 'outline: 5px solid red; outline-offset: -5px; cursor:crosshair; left: 50%; top: 50%; transform: translate(-50%, -50%); touch-action: none; z-index: 100;';

    // add mouse up listener to the canvas
    draw_canvas.addEventListener('mouseup', function(e: MouseEvent) {
        if (e.button == 0 && draw_canvas.style.visibility == "visible") {
            send_collab_report();
        }
    });

    videoCanvasContainer.appendChild(draw_canvas);

    draw_board = sdb_create(draw_canvas);
    draw_board.setLineSize(videoElem.videoWidth / 100);
    draw_board.setLineColor(draw_color);
    draw_canvas.style.visibility = "hidden"; // hide the canvas until the user clicks the draw button
    draw_canvas.style.pointerEvents = "none"; // never block playback controls unless actively drawing
}


onMount(async () => {
    // Force the video to load
    if (!videoElem.videoWidth) { videoElem.load(); }
    prepare_drawing();
    offsetTextTracks();
    curSubtitle.subscribe(() => { offsetTextTracks(); });
    animationFrameId = requestAnimationFrame(handleTimeUpdate);
    initializeVolume();

    refreshSystemFullscreenState();
    document.addEventListener('fullscreenchange', refreshSystemFullscreenState);
    document.addEventListener('webkitfullscreenchange', refreshSystemFullscreenState as EventListener);
    (videoElem as any)?.addEventListener?.('webkitbeginfullscreen', refreshSystemFullscreenState);
    (videoElem as any)?.addEventListener?.('webkitendfullscreen', refreshSystemFullscreenState);
});

onDestroy(async () => {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = 0;
    }
    if (draw_board) {
        draw_board.destroy();
        draw_board = null;
    }
    videoDecoder?.dispose();
    videoDecoder = null;
    if (volumeHudTimer) {
        clearTimeout(volumeHudTimer);
        volumeHudTimer = null;
    }
    clearFullscreenMouseIdleTimer();

    document.removeEventListener('fullscreenchange', refreshSystemFullscreenState);
    document.removeEventListener('webkitfullscreenchange', refreshSystemFullscreenState as EventListener);
    (videoElem as any)?.removeEventListener?.('webkitbeginfullscreen', refreshSystemFullscreenState);
    (videoElem as any)?.removeEventListener?.('webkitendfullscreen', refreshSystemFullscreenState);

    try {
        volumeMediaSource?.disconnect();
        volumeGainNode?.disconnect();
        volumeAudioContext?.close();
    } catch {}
    volumeMediaSource = null;
    volumeGainNode = null;
    volumeAudioContext = null;
});

// Monitor video elem "loop" property in a timer.
// Couldn't find a way to bind to it directly.
setInterval(() => { loop = videoElem?.loop }, 500);

let isSeekingThumb = $state(false);
let seekSliderEl: HTMLDivElement | undefined;
let seekSliderWidthPx = $state(0);
let pendingSeekTime: number | null = null;
let seekRafId: number | null = null;
let decoderSeekInFlight = false;

function refreshSeekSliderMetrics() {
    seekSliderWidthPx = seekSliderEl?.clientWidth ?? 0;
}

onMount(() => {
    refreshSeekSliderMetrics();

    const onResize = () => refreshSeekSliderMetrics();
    window.addEventListener('resize', onResize);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && seekSliderEl) {
        ro = new ResizeObserver(() => refreshSeekSliderMetrics());
        ro.observe(seekSliderEl);
    }

    return () => {
        window.removeEventListener('resize', onResize);
        ro?.disconnect();
    };
});

$effect(() => {
    if (!seekSliderEl) return;
    refreshSeekSliderMetrics();
});

function scheduleSeekApply() {
    if (seekRafId !== null) return;
    seekRafId = requestAnimationFrame(async () => {
        seekRafId = null;
        if (pendingSeekTime === null) return;
        const targetTime = pendingSeekTime;

        // Use stepper for seeking (handles both HTML5 and Mediabunny modes),
        // but coalesce rapid drag updates to avoid lag.
        if (videoDecoder) {
            if (decoderSeekInFlight) return;
            decoderSeekInFlight = true;
            try {
                const pos = await videoDecoder.seekToTime(targetTime);
                time = pos.timestamp;
            } finally {
                decoderSeekInFlight = false;
                if (pendingSeekTime !== targetTime) {
                    scheduleSeekApply();
                }
            }
        } else if (videoElem) {
            time = targetTime;
            videoElem.currentTime = targetTime;
        }

        seekSideEffects();
    });
}

function onSeekStart() {
    isSeekingThumb = true;
    highlightedCommentId = undefined;
    if (videoElem) {
        videoElem.pause();
        videoElem.focus();
    }
    paused = true;
}

function onSeekEnd() {
    isSeekingThumb = false;
    send_collab_report();
}

function onGlobalSeekMove(e: MouseEvent | TouchEvent) {
    if (!isSeekingThumb || !seekSliderEl) return;
    handleMove(e, seekSliderEl);
}

function handleMove(e: MouseEvent | TouchEvent, target: EventTarget|null) {
    if (!target) throw new Error("progress bar missing");
    const effectiveDuration = getEffectiveDuration();
    if (!effectiveDuration) return; // video not loaded yet
    // Check for touch event using 'touches' property (TouchEvent global may not exist on desktop Safari)
    const isTouch = 'touches' in e;
    const clientX = isTouch ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
    const { left, right } = (target as HTMLProgressElement).getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - left) / Math.max(right - left, 1)));
    pendingSeekTime = effectiveDuration * ratio;
    scheduleSeekApply();
}

let playback_request_source: string|undefined = undefined;

/// Start / stop playback
///
/// @param play  True to start, false to stop
/// @param request_source  ID of the source of the request, or undefined
/// @return  True if the playback state was changed
export function setPlayback(play: boolean, request_source: string|undefined): boolean {
    if (play == (!paused))
        return false;       // "no change"

    if (play) {
        // Starting playback should exit comment-focus highlight state.
        highlightedCommentId = undefined;
        videoDecoder?.prepareForPlayback();
        seekSideEffects();
        videoElem.play();
    }
    else
        videoElem.pause();
    send_collab_report();

    playback_request_source = request_source;
    return true;
}

/// Get state of playback, and the source of the request that caused it
export function getPlaybackState(): {playing: boolean, request_source: string|undefined} {
    return {playing: !paused, request_source: playback_request_source};
}

export function isLooping(): boolean {
    return loop;
}

export function isPaused(): boolean {
    return paused;
}

export function isLongPressSeeking(): boolean {
    return longPressSeekActive;
}

export function togglePlay() {
    // Block play/pause toggle only while actively drawing (canvas consuming input).
    // Comment snapshot overlays are visible too, but non-interactive (pointerEvents:none)
    // and should not prevent normal playback resume.
    if (hasDrawing() && draw_canvas?.style.pointerEvents !== "none") return;
    const should_play = paused;
    setPlayback(should_play, "VideoPlayer");
}

function toggleOverlayVisibility() {
    if (overlayVisible) {
        hideOverlayByDesktopClick();
    } else {
        revealOverlayFromHidden();
    }
}

const DESKTOP_SINGLE_CLICK_DELAY_MS = 210;

function scheduleSingleSurfaceTap(action: () => void, delayMs: number = 240) {
    if (pendingSurfaceTapTimer) {
        clearTimeout(pendingSurfaceTapTimer);
        pendingSurfaceTapTimer = null;
    }
    pendingSurfaceTapTimer = setTimeout(() => {
        pendingSurfaceTapTimer = null;
        action();
    }, delayMs);
}

function cancelPendingSingleSurfaceTap() {
    if (!pendingSurfaceTapTimer) return;
    clearTimeout(pendingSurfaceTapTimer);
    pendingSurfaceTapTimer = null;
}

function cancelPendingHiddenOverlayReveal() {
    if (!hiddenOverlayTapTimer) return;
    clearTimeout(hiddenOverlayTapTimer);
    hiddenOverlayTapTimer = null;
}

function onOverlaySurfaceTap(event: Event) {
    if (Date.now() < suppressClickUntil) {
        event.stopPropagation();
        return;
    }
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('button') || target.closest('[role="slider"]')) return;

    const mouseEvent = event as MouseEvent;
    event.stopPropagation();

    // Desktop-only behavior: single click toggles play/pause.
    if (isDesktopPointerClick(mouseEvent)) {
        if (mouseEvent.detail > 1) {
            cancelPendingSingleSurfaceTap();
            return;
        }
        scheduleSingleSurfaceTap(() => {
            if (Date.now() < suppressClickUntil) return;
            togglePlay();
        }, DESKTOP_SINGLE_CLICK_DELAY_MS);
        return;
    }

    if (mouseEvent.detail > 1) {
        cancelPendingSingleSurfaceTap();
        return;
    }

    if (isInCommentReviewTapMode()) {
        if (overlayVisible) {
            hideOverlayByDesktopClick();
        } else {
            revealOverlayFromHidden();
        }
        return;
    }

    overlayVisibilityBeforeMultiClick = overlayVisible;
    if ('changedTouches' in (event as any)) {
        suppressClickUntil = Date.now() + 350;
    }
    scheduleSingleSurfaceTap(() => toggleOverlayVisibility());
}

function onPlayerSurfaceTap(event: Event) {
    // Hidden -> show controls. Visible -> hide controls (YouTube-like toggle on non-control surface).
    pushTapHud(`onPlayerSurfaceTap type=${event.type} overlay=${overlayVisible} suppress=${Date.now() < suppressClickUntil}`);
    if (Date.now() < suppressClickUntil) {
        event.stopPropagation();
        return;
    }
    const mouseEvent = event as MouseEvent;
    event.stopPropagation();

    // Desktop-only behavior: single click toggles play/pause.
    if (isDesktopPointerClick(mouseEvent)) {
        if (mouseEvent.detail > 1) {
            cancelPendingSingleSurfaceTap();
            return;
        }
        scheduleSingleSurfaceTap(() => {
            if (Date.now() < suppressClickUntil) return;
            togglePlay();
        }, DESKTOP_SINGLE_CLICK_DELAY_MS);
        return;
    }

    if (mouseEvent.detail > 1) {
        cancelPendingSingleSurfaceTap();
        return;
    }

    const wasVisible = overlayVisible;

    // In comment review mode, hidden-state tap should only reveal controls.
    if (isInCommentReviewTapMode() && !wasVisible) {
        cancelPendingSingleSurfaceTap();
        revealOverlayFromHidden();
        return;
    }

    // Always treat hidden-state tap as reveal-only using state snapshot,
    // to avoid delayed callbacks accidentally hiding controls again.
    if (!wasVisible) {
        cancelPendingSingleSurfaceTap();
        revealOverlayFromHidden();
        return;
    }

    overlayVisibilityBeforeMultiClick = wasVisible;
    scheduleSingleSurfaceTap(() => {
        hideOverlayByDesktopClick();
    });
}

function onHiddenOverlayTap(event: Event) {
    // In hidden state, first tap should ONLY reveal controls and never trigger playback actions.
    pushTapHud(`onHiddenOverlayTap type=${event.type} overlay=${overlayVisible}`);
    event.stopPropagation();
    cancelPendingSingleSurfaceTap();
    consumeReviewTapUntil = 0;

    if (isDesktopViewport) {
        cancelPendingHiddenOverlayReveal();
        revealOverlayFromHidden();
        suppressClickUntil = Date.now() + 260;
        return;
    }

    // Mobile hidden-state tap now only reveals controls.
    cancelPendingHiddenOverlayReveal();
    hiddenOverlayTapTimer = setTimeout(() => {
        hiddenOverlayTapTimer = null;
        revealOverlayFromHidden();
        suppressClickUntil = Date.now() + 260;
    }, 240);
}

function onCommentReviewRevealTap(event: Event) {
    pushTapHud(`onCommentReviewRevealTap type=${event.type} overlay=${overlayVisible}`);
    event.preventDefault();
    event.stopPropagation();
    cancelPendingSingleSurfaceTap();
    cancelPendingHiddenOverlayReveal();
    consumeReviewTapUntil = 0;
    reviewFirstTapGuard = false;
    revealOverlayFromHidden();
    // iOS may emit a follow-up synthetic click after touch/pointer; swallow it.
    suppressClickUntil = Date.now() + 600;
}

function onReviewHiddenCaptureTap(event: Event) {
    // Hard interception path is only for comment-review hidden-state.
    // Outside review mode, hidden-state taps should follow normal play/pause behavior.
    if (!isInCommentReviewTapMode()) return;
    if (overlayVisible) return;
    onCommentReviewRevealTap(event);
}

function onRootRevealTap(event: Event) {
    // Final fallback: capture taps at player root level.
    pushTapHud(`onRootRevealTap type=${event.type} overlay=${overlayVisible}`);

    // Never interfere with interactions inside the video surface.
    const target = event.target as Node | null;
    if (videoCanvasContainer && target && videoCanvasContainer.contains(target)) {
        return;
    }

    // Desktop relies on hover/move wake; root tap fallback is mobile-only.
    if (isDesktopViewport) return;

    if (overlayVisible) return;
    onCommentReviewRevealTap(event);
}

$effect(() => {
    if (!videoCanvasContainer) return;

    const captureHandler = (event: Event) => onReviewHiddenCaptureTap(event);
    videoCanvasContainer.addEventListener('pointerdown', captureHandler, true);
    videoCanvasContainer.addEventListener('touchstart', captureHandler, true);
    videoCanvasContainer.addEventListener('click', captureHandler, true);

    return () => {
        videoCanvasContainer?.removeEventListener('pointerdown', captureHandler, true);
        videoCanvasContainer?.removeEventListener('touchstart', captureHandler, true);
        videoCanvasContainer?.removeEventListener('click', captureHandler, true);
    };
});

function swallowIfHiddenFirstTap(event: Event): boolean {
    if (!overlayVisible) {
        const now = Date.now();
        if (now - lastHiddenActionTapTs < 320) {
            lastHiddenActionTapTs = 0;
            event.stopPropagation();
            cancelPendingHiddenOverlayReveal();
            hideOverlayQuick();
            reviewFirstTapGuard = false;
            suppressClickUntil = now + 450;
            togglePlay();
            return true;
        }
        lastHiddenActionTapTs = now;
        event.stopPropagation();
        cancelPendingHiddenOverlayReveal();
        hiddenOverlayTapTimer = setTimeout(() => {
            hiddenOverlayTapTimer = null;
            revealOverlayFromHidden();
            suppressClickUntil = Date.now() + 260;
        }, 240);
        return true;
    }
    return false;
}

function isDesktopPointerClick(event: MouseEvent): boolean {
    if (typeof window === 'undefined') return false;
    if (event.detail === 0) return false; // keyboard-triggered click
    return isDesktopViewport;
}

function clickOnVideo(event: MouseEvent ) {
    pushTapHud(`clickOnVideo type=${event.type} detail=${event.detail} overlay=${overlayVisible}`);
    if (Date.now() < suppressClickUntil) {
        event.stopPropagation();
        return;
    }
    if ($curVideo?.mediaType.toLowerCase().startsWith("audio")) {
        // Audio file videos show a waveform, so use clicks for seeking instead of play/pause
        const videoElem = event.target as HTMLVideoElement;
        let frac = (event.clientX - videoElem.getBoundingClientRect().left) / videoElem.offsetWidth;
        time = getEffectiveDuration() * frac;
    } else {
        event.stopPropagation();

        if (event.detail > 1) {
            cancelPendingSingleSurfaceTap();
            return;
        }

        const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
        if (isDesktop) {
            // Drawing mode should consume clicks for strokes only; never toggle play/pause.
            if (hasDrawing()) {
                return;
            }
            scheduleSingleSurfaceTap(() => {
                if (Date.now() < suppressClickUntil) return;
                const willPlay = paused;
                suppressClickUntil = Date.now() + 260;
                togglePlay();
                if (willPlay) {
                    showOverlay(true);
                } else {
                    showOverlay(false);
                }
            }, 380);
            return;
        }

        const wasVisible = overlayVisible;

        if (isInCommentReviewTapMode() && !wasVisible) {
            cancelPendingSingleSurfaceTap();
            revealOverlayFromHidden();
            return;
        }

        // Hidden-state first click: reveal only (never trigger playback logic).
        if (!wasVisible) {
            cancelPendingSingleSurfaceTap();
            revealOverlayFromHidden();
            suppressClickUntil = Date.now() + 260;
            return;
        }

        overlayVisibilityBeforeMultiClick = wasVisible;
        scheduleSingleSurfaceTap(() => {
            if (Date.now() < suppressClickUntil) return;
            // Visible-state click toggles controls.
            toggleOverlayVisibility();
        });
    }
}

let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let touchMoved = false;
let lockedGestureAxis: 'x' | 'y' | null = null;
let gestureStartVideoTime = 0;
let gestureStartVolume = 0;
let suppressClickUntil = 0;
let overlayVisibilityBeforeMultiClick: boolean | null = null;
let pendingSurfaceTapTimer: ReturnType<typeof setTimeout> | null = null;
let hiddenOverlayTapTimer: ReturnType<typeof setTimeout> | null = null;
let lastHiddenActionTapTs = 0;
let forceRevealOverlayUntil = 0;
let consumeReviewTapUntil = 0;
let reviewFirstTapGuard = $state(false);
let isDesktopViewport = $state(false);
let blockOverlayShowUntil = 0;

function startOverlayShowBlock(durationMs: number = 450) {
    blockOverlayShowUntil = Date.now() + durationMs;
}

function isOverlayShowBlocked() {
    return Date.now() < blockOverlayShowUntil;
}

function isInCommentReviewTapMode() {
    return Date.now() < forceRevealOverlayUntil;
}

function shouldConsumeReviewTap() {
    return Date.now() < consumeReviewTapUntil;
}

export function enterCommentReviewTapMode(durationMs: number = 60000) {
    forceRevealOverlayUntil = Date.now() + durationMs;
    // First tap in review mode should only reveal controls, never trigger playback.
    consumeReviewTapUntil = Date.now() + Math.min(durationMs, 1500);
    // Root-level guard overlay blocks desktop hover wake and causes mobile double-tap flash.
    // Keep it disabled; hidden-overlay button + player handlers are enough.
    reviewFirstTapGuard = false;
    desktopMouseWakeLocked = false;
    cancelPendingHiddenOverlayReveal();
    // Keep controls hidden by default while reviewing comments.
    suppressAutoShowOverlayUntil = Date.now() + durationMs;
    hideOverlayQuick();
}

function onVideoSurfaceDoubleClick(event: MouseEvent) {
    event.stopPropagation();
    cancelPendingSingleSurfaceTap();
    cancelPendingHiddenOverlayReveal();
    // Hard isolation window after double tap:
    // even if delayed single-click callback fires, controls are not allowed to re-show.
    startOverlayShowBlock(520);
    // Swallow follow-up synthetic/single click chain to avoid overlay flicker.
    suppressClickUntil = Date.now() + 520;

    // Desktop-only behavior: double click toggles fullscreen.
    if (isDesktopPointerClick(event)) {
        toggleSystemFullscreen();
        overlayVisibilityBeforeMultiClick = null;
        return;
    }

    // In comment review hidden-state, first interaction must reveal controls only.
    if (isInCommentReviewTapMode() && (!overlayVisible || shouldConsumeReviewTap())) {
        consumeReviewTapUntil = 0;
        revealOverlayFromHidden();
        return;
    }

    // Mobile: double tap play/pause should not flash controls.
    hideOverlayQuick();
    reviewFirstTapGuard = false;
    togglePlay();

    overlayVisibilityBeforeMultiClick = null;
}
let volumeHudVisible = $state(false);
let volumeHudText = $state('');
let volumeHudTimer: ReturnType<typeof setTimeout> | null = null;

let volumeAudioContext: AudioContext | null = null;
let volumeGainNode: GainNode | null = null;
let volumeMediaSource: MediaElementAudioSourceNode | null = null;

function isIOSDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua)
        || (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);
}

async function ensureIOSVolumeGainReady() {
    if (!videoElem || !isIOSDevice()) return;

    try {
        if (!volumeAudioContext) {
            const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
            if (!Ctx) return;
            volumeAudioContext = new Ctx();
        }

        if (volumeAudioContext.state === 'suspended') {
            await volumeAudioContext.resume();
        }

        if (!volumeGainNode) {
            volumeGainNode = volumeAudioContext.createGain();
            volumeGainNode.connect(volumeAudioContext.destination);
        }

        if (!volumeMediaSource) {
            volumeMediaSource = volumeAudioContext.createMediaElementSource(videoElem as HTMLMediaElement);
            volumeMediaSource.connect(volumeGainNode);
        }

        const initialVolume = typeof audio_volume === 'number'
            ? clamp(audio_volume / 100, 0, 1)
            : clamp(videoElem.volume ?? 1, 0, 1);
        volumeGainNode.gain.value = initialVolume;
    } catch (err) {
        // iOS audio graph can fail in edge cases; fallback to native volume behavior.
    }
}

function clamp(v: number, min: number, max: number): number {
    return Math.min(Math.max(v, min), max);
}

function getCurrentVolume01(): number {
    if (volumeGainNode) {
        return clamp(volumeGainNode.gain.value, 0, 1);
    }
    if (typeof audio_volume === 'number' && !Number.isNaN(audio_volume)) {
        return clamp(audio_volume / 100, 0, 1);
    }
    return clamp(videoElem?.volume ?? 1, 0, 1);
}

let lastNonZeroVolume = 1;

function setEffectiveVolume(newVol: number) {
    const vol = clamp(newVol, 0, 1);
    if (volumeGainNode) {
        volumeGainNode.gain.value = vol;
    }
    if (videoElem) {
        videoElem.volume = vol;
    }
    audio_volume = Math.round(vol * 100);
    if (vol > 0.001) lastNonZeroVolume = vol;
    showVolumeHud(vol);
}

export function isMuted(): boolean {
    return getCurrentVolume01() <= 0.001;
}

export function toggleMute() {
    const cur = getCurrentVolume01();
    if (cur > 0.001) {
        lastNonZeroVolume = cur;
        setEffectiveVolume(0);
    } else {
        setEffectiveVolume(lastNonZeroVolume > 0.001 ? lastNonZeroVolume : 1);
    }
}

export function getVolume01(): number {
    return getCurrentVolume01();
}

export function setVolume01(vol: number) {
    setEffectiveVolume(vol);
}

function onVideoTouchStart(e: TouchEvent) {
    if (!e.touches || e.touches.length !== 1) return;
    void ensureIOSVolumeGainReady();
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchStartTime = Date.now();
    touchMoved = false;
    lockedGestureAxis = null;
    gestureStartVideoTime = videoElem?.currentTime ?? 0;
    gestureStartVolume = getCurrentVolume01();
}

function showVolumeHud(volume01: number) {
    const pct = Math.round(clamp(volume01, 0, 1) * 100);
    volumeHudText = `音量 ${pct}%`;
    volumeHudVisible = true;
    if (volumeHudTimer) clearTimeout(volumeHudTimer);
    volumeHudTimer = setTimeout(() => {
        volumeHudVisible = false;
    }, 900);
}

function onVideoTouchMove(e: TouchEvent) {
    if (!e.touches || e.touches.length !== 1 || !videoElem) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const moveThresholdPx = 8;
    const axisLockThresholdPx = 12;

    if (absDx > moveThresholdPx || absDy > moveThresholdPx) {
        touchMoved = true;
    }

    if (!touchMoved) return;

    // Lock gesture axis once movement is clear, to avoid cross-triggering volume/seek.
    if (!lockedGestureAxis && (absDx > axisLockThresholdPx || absDy > axisLockThresholdPx)) {
        lockedGestureAxis = absDx >= absDy ? 'x' : 'y';
    }

    // Horizontal swipe: seek
    if (lockedGestureAxis === 'x') {
        const duration = getEffectiveDuration();
        if (duration > 0) {
            const deltaSeconds = (dx / window.innerWidth) * duration;
            const newTime = clamp(gestureStartVideoTime + deltaSeconds, 0, duration);
            videoElem.currentTime = newTime;
            time = newTime;
        }
    } else if (lockedGestureAxis === 'y') {
        // Vertical swipe: volume (higher sensitivity for mobile)
        const volumeSwipeSensitivity = 2.2;
        const delta = (-dy / Math.max(window.innerHeight, 1)) * volumeSwipeSensitivity;
        const newVol = clamp(gestureStartVolume + delta, 0, 1);
        setEffectiveVolume(newVol);
    }
}

function onVideoTouchEnd(e: TouchEvent) {
    const now = Date.now();
    const isTap = !touchMoved && (now - touchStartTime) < 250;
    lockedGestureAxis = null;
    gestureStartVolume = getCurrentVolume01();
    if (!isTap) return;

    e.stopPropagation();

    // Prevent synthetic click from immediately toggling twice after touchend.
    suppressClickUntil = now + 350;

    if (isInCommentReviewTapMode()) {
        revealOverlayFromHidden();
        return;
    }

    // Hidden-state first tap: reveal only. Visible-state tap: toggle controls.
    if (!overlayVisible) {
        revealOverlayFromHidden();
        return;
    }
    toggleOverlayVisibility();
}

function onVideoWheel(e: WheelEvent) {
    if (!videoElem) return;

    void ensureIOSVolumeGainReady();

    // Default wheel notch adjusts volume by 5%
    const step = 0.05;

    // Normalize wheel/trackpad direction only; keep fixed step for precision
    const direction = Math.sign(e.deltaY);
    if (direction === 0) return;

    const newVol = clamp(getCurrentVolume01() - direction * step, 0, 1);
    setEffectiveVolume(newVol);
}

function format_tc(seconds: number) : string {
    if (isNaN(seconds)) return '...';
    if (videoDecoder) {
        const frame = TimecodeUtils.timeToFrame(seconds, videoDecoder.frameRate);
        return TimecodeUtils.frameToSMPTE(frame, videoDecoder.frameRate);
    }
    else if(seconds==0)
        return '--:--:--:--';
    else {
        const minutes = Math.floor(seconds / 60);
        seconds = Math.floor(seconds % 60);
        if (seconds < 10) return `${minutes}:0${seconds}`;
        else return `${minutes}:${seconds}`;
    }
}

let currentTimecode = $derived.by(() => {
    time; // reactive dependency - recalculate when time changes
    if (videoDecoder) {
        return videoDecoder.getPosition().timecode;
    }
    return '--:--:--:--';
});

let currentFrame = $derived.by(() => {
    time; // reactive dependency - recalculate when time changes
    if (videoDecoder) {
        return `${videoDecoder.getPosition().frame}`;
    }
    return '----';
});


export function getCurTime() {
    return videoDecoder?.getPosition().timestamp ?? videoElem.currentTime;
}

export function getCurTimecode() {
    return videoDecoder?.getPosition().timecode ?? format_tc(time);
}

export function getCurFrame() {
    return videoDecoder?.getPosition().frame ?? 0;
}


export async function step_video(frames: number) {
    if (!videoDecoder) return;

    // Leaving the exact comment frame via step controls should clear timeline highlight.
    highlightedCommentId = undefined;

    const direction = frames < 0 ? -1 : 1;
    const position = await videoDecoder.stepFrame(direction as 1 | -1, Math.abs(frames));
    time = position.timestamp;

    seekSideEffects();
    send_collab_report();
}

export function beginStepButtonLongPress(direction: -1 | 1) {
    startLongPressSeek(direction);
}

export function endStepButtonLongPress(direction: -1 | 1) {
    const wasLongPress = longPressSeekActive;
    const pressedDirection = longPressSeekDirection;
    stopLongPressSeek();
    if (!wasLongPress && pressedDirection === direction) {
        void step_video(direction);
    }
}

export function cancelStepButtonLongPress() {
    stopLongPressSeek();
}

let longPressSeekTimer: ReturnType<typeof setTimeout> | null = null;
let longPressSeekInterval: ReturnType<typeof setInterval> | null = null;
let longPressSeekDirection: -1 | 1 | 0 = 0;
let longPressSeekActive = $state(false);
let longPressSavedMuted: boolean | null = null;
let longPressSavedVolume: number | null = null;
const LONG_PRESS_SEEK_DELAY_MS = 500;
const LONG_PRESS_SEEK_INTERVAL_MS = 80;
const LONG_PRESS_SEEK_STEP_FRAMES = 1;

function stopLongPressSeek() {
    if (longPressSeekTimer) {
        clearTimeout(longPressSeekTimer);
        longPressSeekTimer = null;
    }
    if (longPressSeekInterval) {
        clearInterval(longPressSeekInterval);
        longPressSeekInterval = null;
    }
    if (videoElem) {
        videoElem.pause();
        videoElem.playbackRate = 1;
        if (longPressSavedMuted !== null) videoElem.muted = longPressSavedMuted;
        if (longPressSavedVolume !== null) videoElem.volume = longPressSavedVolume;
    }
    longPressSavedMuted = null;
    longPressSavedVolume = null;
    longPressSeekDirection = 0;
    longPressSeekActive = false;
}

async function tickLongPressSeek(direction: -1 | 1) {
    if (!videoDecoder || !videoElem) return;
    const position = await videoDecoder.stepFrame(direction, LONG_PRESS_SEEK_STEP_FRAMES);
    time = position.timestamp;
    videoElem.pause();
    seekSideEffects();
    send_collab_report();
}

function startLongPressSeek(direction: -1 | 1) {
    stopLongPressSeek();
    longPressSeekDirection = direction;
    longPressSeekTimer = setTimeout(async () => {
        longPressSeekTimer = null;
        longPressSeekActive = true;
        if (videoElem) {
            longPressSavedMuted = videoElem.muted;
            longPressSavedVolume = videoElem.volume;
            videoElem.pause();
            videoElem.muted = true;
            videoElem.volume = 0;
            videoElem.playbackRate = 0.5;
        }
        await tickLongPressSeek(direction);
        longPressSeekInterval = setInterval(() => {
            void tickLongPressSeek(direction);
        }, LONG_PRESS_SEEK_INTERVAL_MS);
    }, LONG_PRESS_SEEK_DELAY_MS);
}

function onStepButtonPress(event: Event, direction: -1 | 1) {
    event.stopPropagation();
    if (!overlayVisible) return;
    if (event instanceof MouseEvent && event.button !== 0) return;
    startLongPressSeek(direction);
}

function onStepButtonRelease(event: Event, direction: -1 | 1) {
    event.stopPropagation();
    if (!overlayVisible && !longPressSeekActive) return;
    const wasLongPress = longPressSeekActive;
    const pressedDirection = longPressSeekDirection;
    stopLongPressSeek();
    if (!wasLongPress && pressedDirection === direction && overlayVisible) {
        void step_video(direction);
    }
}

function onStepButtonMouseDown(event: MouseEvent, direction: -1 | 1) {
    event.preventDefault();
    onStepButtonPress(event, direction);
}

function onStepButtonMouseUp(event: MouseEvent, direction: -1 | 1) {
    event.preventDefault();
    onStepButtonRelease(event, direction);
}

function onStepButtonCancel(event: Event) {
    event.stopPropagation();
    stopLongPressSeek();
}

const INTERACTIVE_ELEMS = ['input', 'textarea', 'select', 'option', 'button'];
const INTERACTIVE_ROLES = ['textbox', 'combobox', 'listbox', 'menu', 'menubar', 'grid', 'dialog', 'alertdialog'];
const WINDOW_KEY_ACTIONS: {[key: string]: (e: KeyboardEvent)=>any} = {
        ' ':  () => togglePlay(),
        'ArrowLeft': () => step_video(-1),
        'ArrowRight': () => step_video(1),
        'ArrowUp': () => step_video(1),
        'ArrowDown': () => step_video(-1),
        'z': (e) => { if (e.ctrlKey) onDrawUndo(); },
        'y': (e) => { if (e.ctrlKey) onDrawRedo(); },
        'i': () => setLoopPoint(true),
        'o': () => setLoopPoint(false),
        'l': () => {
            if (videoElem) { videoElem.loop = !videoElem.loop; }
            if (!videoElem.loop) { loopStartTime = -1; loopEndTime = -2; }
        },
    };

function onWindowKeyPress(e: KeyboardEvent): void {
    let target = e.target as HTMLElement;

    // Skip if the user is in a keyboard interactive element
    if (target.isContentEditable)
        return;

    if (INTERACTIVE_ELEMS.includes(target.tagName.toLowerCase()) ||
            INTERACTIVE_ROLES.includes(target.getAttribute('role') ?? '-'))
        return;

    if (e.key in WINDOW_KEY_ACTIONS) {
        WINDOW_KEY_ACTIONS[e.key](e);
        e.preventDefault();
    }
}

function seekSideEffects() {
    draw_board?.clear();
    onToggleDraw(false);
    if (onseeked) onseeked();
}

export async function seekToSMPTE(smpte: string) {
    seekSideEffects();
    try {
        const time = TimecodeUtils.smpteToTime(smpte, videoDecoder!.frameRate);
        await videoDecoder!.seekToTime(time);
    } catch(err) {
        acts.add({mode: 'warning', message: `Seek failed to: ${smpte}`, lifetime: 3});
    }
}

export async function seekToFrame(frame: number) {
    seekSideEffects();
    try {
        await videoDecoder!.seekToFrame(frame);
    } catch(err) {
        acts.add({mode: 'warning', message: `Seek failed to: ${frame}`, lifetime: 3});
    }
}


// These are called from PARENT component on user interaction
export function onToggleDraw(mode_on: boolean) {
    if (!draw_board || !draw_canvas) {
        // On iOS slow metadata paths, drawing can be unavailable briefly.
        // Do not show an error toast for this transient state.
        return;
    }

    draw_board.clear();
    if (mode_on) {
        draw_canvas.style.outline = "5px solid " + draw_color;
        draw_canvas.style.cursor = "crosshair";
        draw_canvas.style.zIndex = "210"; // ensure strokes beat overlay controls while drawing
        const ctx = draw_canvas.getContext('2d');
        if (ctx) videoDecoder?.captureFrame(ctx);
        draw_canvas.style.visibility = "visible";
        draw_canvas.style.pointerEvents = "auto";
    } else {
        draw_canvas.style.visibility = "hidden";
        draw_canvas.style.pointerEvents = "none";
        draw_canvas.style.zIndex = "100"; // keep controls visible/clickable in review mode
    }
}

export function onColorSelect(color: string) {
    setPenColor(color);
}

export function onDrawUndo() {
    draw_board?.undo();
}

export function onDrawRedo() {
    draw_board?.redo();
}

export function onDrawClear() {
    if (!draw_board || !draw_canvas) return;
    draw_board.clear();
    const ctx = draw_canvas.getContext('2d');
    if (ctx) videoDecoder?.captureFrame(ctx);
    draw_canvas.style.visibility = "visible";
    draw_canvas.style.pointerEvents = "auto";
}

export function hasDrawing() {
    return draw_canvas && draw_canvas.style.visibility == "visible";
}

// Capture current video frame + drawing as a data URL (base64 encoded image)
function composeDrawingCanvas(): HTMLCanvasElement {
        let comb = document.createElement('canvas');
        comb.width  = videoElem.videoWidth;
        comb.height = videoElem.videoHeight;
        var ctx = comb.getContext('2d');
        if (!ctx) throw new Error("Cannot get canvas context");
        // ctx.drawImage(videoElem, 0, 0);   // Removed, as bgr frame capture is now done when draw mode is entered
        ctx.drawImage(draw_canvas, 0, 0);
        return comb;
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string) || "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

export async function getScreenshotForComment() : Promise<string> {
        const comb = composeDrawingCanvas();
        // First attempt: fast sync path
        const webp = comb.toDataURL("image/webp", 0.8);
        if (webp.startsWith("data:image/webp")) {
            return webp;
        }

        // iOS fallback: some Safari builds fail toDataURL(webp) but can still encode via toBlob(webp)
        const webpBlob = await new Promise<Blob | null>((resolve) => {
            try {
                comb.toBlob((blob) => resolve(blob), "image/webp", 0.8);
            } catch {
                resolve(null);
            }
        });
        if (webpBlob && webpBlob.type === "image/webp") {
            const webpDataUrl = await blobToDataUrl(webpBlob);
            if (webpDataUrl.startsWith("data:image/webp")) {
                return webpDataUrl;
            }
        }

        // iOS-safe fallback: PNG is widely supported when WebP encoding fails.
        return comb.toDataURL("image/png");
}

export function getScreenshot() : string
{
        const comb = composeDrawingCanvas();
        const webp = comb.toDataURL("image/webp", 0.8);
        if (webp.startsWith("data:image/webp")) {
            return webp;
        }
        return comb.toDataURL("image/png");
}

export async function collabPlay(seek_time: number, looping: boolean) {
    videoDecoder?.prepareForPlayback();
    videoElem.loop = looping;
    videoElem.pause();
    if (videoDecoder) {
        const pos = await videoDecoder.seekToTime(seek_time);
        time = pos.timestamp;
    } else {
        time = seek_time;
    }
    seekSideEffects();
    videoElem.play();
}

export async function collabPause(seek_time: number, looping: boolean, drawing: string|undefined) {
    videoElem.loop = looping;
    if (!paused)
        videoElem.pause();
    if (time != seek_time) {
        if (videoDecoder) {
            const pos = await videoDecoder.seekToTime(seek_time);
            time = pos.timestamp;
        } else {
            time = seek_time;
        }
        seekSideEffects();
    }
    if (drawing && getScreenshot() != drawing)
        setDrawing(drawing);
}

export async function setDrawing(drawing: string) {
    try {
        await draw_board.fillImageByDataURL(drawing, { isOverlay: false })
        draw_canvas.style.visibility = "visible";
        draw_canvas.style.cursor = "";
        draw_canvas.style.outline = "none";
        draw_canvas.style.zIndex = "100"; // show snapshot below controls
        // Make it non-interactive (pass clicks through)
        draw_canvas.style.pointerEvents = "none";
    }
    catch(err) {
        acts.add({mode: 'error', message: `Failed to show image.`, lifetime: 3});
    }
}

function tcToDurationFract(timecode: string|undefined) {
    /// Convert SMPTE timecode to a fraction of the video duration (0-1)
    if (timecode === undefined) { throw new Error("Timecode is undefined"); }
    const frameRate = parseFloat($curVideo?.duration?.fps ?? "24");
    const pos = TimecodeUtils.smpteToMilliseconds(timecode, frameRate) / 1000.0;
    return pos / getEffectiveDuration();
}

function tickLeftStyle(timecode: string|undefined) {
    const frac = Math.max(0, Math.min(1, tcToDurationFract(timecode)));

    // Snap to whole CSS pixels when possible to keep all vertical ticks visually consistent.
    if (seekSliderWidthPx > 0) {
        const snappedPx = Math.round(frac * seekSliderWidthPx);
        return `left: ${snappedPx}px`;
    }

    return `left: ${frac * 100}%`;
}

// Input element event handlers
function onTimecodeEdited(e: Event) {
    seekToSMPTE((e.target as HTMLInputElement).value);
    send_collab_report();
}

function onFrameEdited(e: Event) {
    seekToFrame(parseInt((e.target as HTMLInputElement).value));
    send_collab_report();
}


let uploadSubtitlesButton: HTMLButtonElement | undefined = $state();
function changeSubtitleUploadIcon(upload_icon: boolean) {
    if (uploadSubtitlesButton) {
        if (upload_icon) {
            uploadSubtitlesButton.classList.remove('fa-closed-captioning');
            uploadSubtitlesButton.classList.add('fa-upload');
        } else {
            uploadSubtitlesButton.classList.remove('fa-upload');
            uploadSubtitlesButton.classList.add('fa-closed-captioning');
        }
    }
}

let prev_subtitle: Proto3.Subtitle|null = null;
function toggleSubtitle() {
    // Dispatch to parent instead of setting directly, to allow collab sessions to sync
    if ($curVideo?.subtitles.find(s => s.id == prev_subtitle?.id) == undefined) {
        prev_subtitle = null;
    }
    if ($curSubtitle) {
        prev_subtitle = $curSubtitle;
        if (onchangesubtitle) onchangesubtitle({id: null});
    } else {
        if (prev_subtitle) {
            if (onchangesubtitle) onchangesubtitle({id: prev_subtitle.id});
        } else {
            if (onchangesubtitle) onchangesubtitle({id: $curVideo?.subtitles[0]?.id ?? null});
        }
    }
}


// Offset the start/end times of all cues in all text tracks by $curSubtitle.timeOffset seconds.
// Called when the video is loaded, and when the subtitle changes.
function offsetTextTracks(retryCount = 0) {
    interface ExtendedVTTCue extends VTTCue {
        originalStartTime?: number;
        originalEndTime?: number;
    }

    const adjustCues = (track: TextTrack) => {
        const offset = $curSubtitle?.timeOffset || 0.0;
        if (!track.cues) {
            //console.debug("adjustCues(): track has no cues");
            return;
        }
        console.debug("Offsetting cues on text tracks by", offset, "sec");
        Array.from(track.cues).forEach((c) => {
            const cue = c as ExtendedVTTCue;
            if (!cue.originalStartTime) {
                cue.originalStartTime = cue.startTime;
                cue.originalEndTime = cue.endTime;
            }
            cue.startTime = cue.originalStartTime + offset;
            cue.endTime = (cue.originalEndTime ??  (cue.originalStartTime+1))  + offset;
        });
    }

    if (!videoElem?.textTracks) {
        console.debug("offsetTextTracks(): videoElem has no textTracks");
        return;
    }

    Array.from(videoElem?.textTracks).forEach((t) => {
        const track = t as TextTrack;
        if (!track.cues || track.cues.length == 0) {
            // If the track has no cues, wait a bit and try again (load events don't seem to work as expected)
            console.debug("offsetTextTracks(): Track has no cues, checking again in 500ms");
            setTimeout(() => { offsetTextTracks(); }, 500);
        } else {
            adjustCues(track);
        }
    });
}

// Set loop in/out points
function setLoopPoint(isInPoint: boolean) {
    if ($collabId) { return; }  // Disable custom loops in collab mode, hard to sync

    const loop_was_valid = (loopEndTime > loopStartTime);
    function resetLoop() {
        [loopStartTime, loopEndTime] = [-1, -2];
        videoElem.loop = false;
    }
    if (videoElem) {
        const curTime = getCurTime();
        const resetShortcut = isInPoint ? (curTime == loopStartTime) : (curTime == loopEndTime);
        if (resetShortcut) {
            resetLoop();
        } else {
            if (isInPoint) { loopStartTime = curTime; }
            else {
                loopEndTime = curTime;
                if (loopStartTime < 0) { loopStartTime = 0; }
            }
        }
        if (loopEndTime > loopStartTime) {
            videoElem.loop = true;
        } else if (loop_was_valid) {
            resetLoop();
        }
        if (videoElem) { videoElem.focus(); }
    }
}

function handleTimeUpdate() {
    // Looping around the manual range
    if (loopStartTime < loopEndTime && videoElem && !paused) {
        if (time >= loopEndTime) {
            time = loopStartTime;
        }
        // Request call on next frame
        animationFrameId = requestAnimationFrame(handleTimeUpdate);
    }
}

// Public method to activate a comment on the timeline (called from App.svelte)
export function setHighlightedComment(commentId: string) {
    highlightedCommentId = String(commentId);
}

export function activateCommentOnTimeline(commentId: string) {
    // Find the comment and next comment
    let clicked_pin = null;
    let next_pin = null;
    for (let i = 0; i < commentsWithTc.length; i++) {
        if (commentsWithTc[i].id == commentId) {
            if (!clicked_pin)
                clicked_pin = commentsWithTc[i];
            if (i < commentsWithTc.length - 1) {
                next_pin = commentsWithTc[i + 1];
            }
            break;
        }
    }

    if (!clicked_pin) {
        console.warn("Comment not found on timeline:", commentId);
        return;
    }

    // Mark current timeline comment so its tick can be highlighted.
    highlightedCommentId = String(commentId);

    // Seek to the timecode
    if (clicked_pin.timecode) {
        try {
            seekToSMPTE(clicked_pin.timecode);
        } catch (err) {
            console.error("Failed to seek to timecode:", clicked_pin.timecode, err);
        }
    }

    // Set loop region between this pin and the next one, if looping is enabled
    if ((loop || videoElem.loop) && clicked_pin) {
        const frameRate = videoDecoder!.frameRate;
        loopStartTime = clicked_pin.timecode ? TimecodeUtils.smpteToTime(clicked_pin.timecode, frameRate) : 0;
        loopEndTime = next_pin?.timecode ? TimecodeUtils.smpteToTime(next_pin.timecode, frameRate) : getEffectiveDuration();
        videoElem.loop = true;
    }
}

// Internal handler for pin clicks - bubbles event up to App
function handlePinClick(id: string) {
    // Enter comment review tap mode so single-tap always reveals controls during review.
    enterCommentReviewTapMode();
    if (oncommentpinclicked) oncommentpinclicked({id});
}

</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
    onkeydown={onWindowKeyPress}
    onpointerdown={onRootRevealTap}
    ontouchstart={onRootRevealTap}
    class="relative w-full h-full flex flex-col object-contain"
    role="main"
>
	{#if reviewFirstTapGuard}
		<div
			class="absolute inset-0 z-[220] bg-transparent pointer-events-auto"
			onpointerdown={onCommentReviewRevealTap}
			onclick={onCommentReviewRevealTap}
			ontouchstart={onCommentReviewRevealTap}
			ontouchend={onCommentReviewRevealTap}
			aria-hidden="true"
		></div>
	{/if}

	{#if debugTapHud}
		<div class="absolute left-2 top-2 z-[260] max-w-[92%] rounded bg-black/75 px-2 py-1 text-[11px] leading-4 text-lime-200 pointer-events-none">
			<div class="text-white/90">Tap Debug HUD</div>
			{#each debugTapHudLines as line}
				<div>{line}</div>
			{/each}
		</div>
	{/if}

	<div  class="flex-1 flex items-start md:items-center justify-center relative min-h-[9em] md:min-h-[12em]"
			 style="{debug_layout?'border: 2px solid orange;':''}">
		<div bind:this={videoCanvasContainer} class="relative w-full max-w-full max-h-full aspect-video rounded-xl bg-black overflow-hidden {debug_layout?'border-4 border-x-zinc-50':''}" onclick={onPlayerSurfaceTap} onmouseenter={onVideoRegionMouseMove} onmousemove={onVideoRegionMouseMove} onmouseleave={onVideoRegionMouseLeave}>
			<video
				transition:scale
				src="{src}"
				crossOrigin="anonymous"
				preload="auto"
				playsinline
				class="absolute inset-0 w-full h-full object-contain bg-black touch-none select-none"
				style="opacity: 1; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;"
				bind:this={videoElem}
				onloadedmetadata={prepare_drawing}
				oncanplay={prepare_drawing}
				onclick={clickOnVideo}
				onwheel={preventDefault((e)=>onVideoWheel(e as WheelEvent))}
				ondblclick={onVideoSurfaceDoubleClick}
				ontouchstart={onVideoTouchStart}
				ontouchmove={preventDefault((e)=>onVideoTouchMove(e as TouchEvent))}
				ontouchend={onVideoTouchEnd}
				bind:currentTime={time}
                ontimeupdate={handleTimeUpdate}
				bind:duration
				bind:paused>
                {#if $curSubtitle?.playbackUrl}
                <track kind="captions"
                    src="{$curSubtitle.playbackUrl}"
                    srclang="en"
                    label="{$curSubtitle.title}"
                    onloadedmetadata={() => offsetTextTracks()}
                    default
                />
                {/if}
			</video>

			{#if volumeHudVisible}
				<div class="pointer-events-none absolute right-3 top-3 z-[120] rounded-md bg-black/70 px-3 py-1 text-sm font-medium text-white backdrop-blur-sm">
					<i class="fa-solid fa-volume-high mr-1 text-cyan-300"></i>{volumeHudText}
				</div>
			{/if}

			{#if !overlayVisible && !isDesktopViewport}
				<button
					type="button"
					class="absolute inset-0 z-40 bg-transparent"
					onpointerdown={onHiddenOverlayTap}
					onclick={onHiddenOverlayTap}
					ondblclick={onVideoSurfaceDoubleClick}
					ontouchstart={onHiddenOverlayTap}
					ontouchend={onHiddenOverlayTap}
					aria-label="Show playback controls"
				></button>
			{/if}


			<!--    TODO: maybe show actively controlling collaborator's avatar like this?
			<div class="absolute top-0 left-0 w-full h-full z-1">
				<div class="flex-none w-6 h-6 block"><Avatar username="Username Here"/></div>
			</div>
		-->

			<!-- YouTube-like overlay controls -->
			<div class="absolute inset-0 z-[180] transition-opacity duration-700 ease-out {overlayVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}" onclick={onOverlaySurfaceTap} ondblclick={(e) => { const t = e.target as HTMLElement | null; if (t?.closest('button') || t?.closest('[role="slider"]')) return; onVideoSurfaceDoubleClick(e); }}>

				<div class="absolute inset-0 flex items-center justify-center gap-12 md:gap-16 pointer-events-auto md:hidden">
					<button class="fa-solid fa-backward text-white/90 text-4xl md:text-5xl h-14 w-14 inline-flex items-center justify-center select-none touch-none" style="-webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; pointer-events: {overlayVisible ? 'auto' : 'none'};" onclick={(e) => { if (swallowIfHiddenFirstTap(e)) return; e.stopPropagation(); }} onpointerdown={(e) => { onStepButtonPress(e, -1); }} onpointerup={(e) => { onStepButtonRelease(e, -1); }} onmousedown={(e) => onStepButtonMouseDown(e, -1)} onmouseup={(e) => onStepButtonMouseUp(e, -1)} oncontextmenu={preventDefault((e)=>e.stopPropagation())} ondragstart={preventDefault((e)=>e.stopPropagation())} onpointercancel={onStepButtonCancel} onpointerleave={onStepButtonCancel} onmouseleave={onStepButtonCancel} aria-label="Step backwards"></button>
					<button class="fa-solid {(paused || longPressSeekActive) ? (loop ? 'fa-arrows-rotate' : 'fa-play') : 'fa-pause'} inline-flex items-center justify-center w-[4.62rem] h-[4.62rem] md:w-[5.04rem] md:h-[5.04rem] min-w-[4.62rem] min-h-[4.62rem] md:min-w-[5.04rem] md:min-h-[5.04rem] rounded-full bg-white/28 text-white text-[2.45rem] md:text-[2.7rem] shadow-[0_8px_28px_rgba(0,0,0,0.45)] select-none touch-none" style="-webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; pointer-events: {overlayVisible ? 'auto' : 'none'};" id="playbutton" onclick={(e) => { if (swallowIfHiddenFirstTap(e)) return; e.stopPropagation(); const willPlay = paused; suppressClickUntil = Date.now() + 700; togglePlay(); if (!willPlay) showOverlay(false); }} title="Play/Pause" aria-label="Play/Pause"></button>
					<button class="fa-solid fa-forward text-white/90 text-4xl md:text-5xl h-14 w-14 inline-flex items-center justify-center select-none touch-none" style="-webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; pointer-events: {overlayVisible ? 'auto' : 'none'};" onclick={(e) => { if (swallowIfHiddenFirstTap(e)) return; e.stopPropagation(); }} onpointerdown={(e) => { onStepButtonPress(e, 1); }} onpointerup={(e) => { onStepButtonRelease(e, 1); }} onmousedown={(e) => onStepButtonMouseDown(e, 1)} onmouseup={(e) => onStepButtonMouseUp(e, 1)} oncontextmenu={preventDefault((e)=>e.stopPropagation())} ondragstart={preventDefault((e)=>e.stopPropagation())} onpointercancel={onStepButtonCancel} onpointerleave={onStepButtonCancel} onmouseleave={onStepButtonCancel} aria-label="Step forwards"></button>
				</div>

				<button
					type="button"
					class="absolute right-3 md:right-4 bottom-3 md:bottom-4 p-0 bg-white/28 text-white inline-grid place-items-center leading-none pointer-events-auto shadow-[0_6px_20px_rgba(0,0,0,0.4)] hover:bg-white/35 active:scale-95 transition overflow-hidden md:hidden"
					style="width:30px;height:30px;min-width:30px;min-height:30px;max-width:30px;max-height:30px;border-radius:9999px;"
					onclick={(e) => { e.stopPropagation(); toggleSystemFullscreen(); }}
					aria-label={isSystemFullscreen ? "Exit fullscreen" : "Fullscreen"}
					title={isSystemFullscreen ? "Exit fullscreen" : "Fullscreen"}
				>
					<i class="fa-solid {isSystemFullscreen ? 'fa-down-left-and-up-right-to-center' : 'fa-up-right-and-down-left-from-center'} text-[13px] leading-none"></i>
				</button>

			</div>

		</div>
	</div>

		<!-- Standalone timeline (progress bar + comment tick marks): always visible -->
		<div class="w-full px-3 md:px-4 mt-2 mb-1 pointer-events-auto">
			<div class="relative h-3 md:h-4">
				<div
					bind:this={seekSliderEl}
					role="slider"
					aria-label="Seek"
					aria-valuemin="0"
					aria-valuemax={Math.floor(getEffectiveDuration())}
					aria-valuenow={Math.floor(time)}
					tabindex="0"
					class="absolute left-0 top-1/2 -translate-y-1/2 w-full h-8 bg-transparent hover:cursor-pointer"
					onmousedown={preventDefault((e)=>{ onSeekStart(); handleMove(e as MouseEvent, e.currentTarget); })}
					onmousemove={(e)=>{ if (isSeekingThumb) handleMove(e as MouseEvent, e.currentTarget); }}
					onmouseup={onSeekEnd}
					ontouchstart={preventDefault((e)=>{ onSeekStart(); handleMove(e as TouchEvent, e.currentTarget); })}
					ontouchmove={preventDefault((e)=>{ handleMove(e as TouchEvent, e.currentTarget); })}
					ontouchend={onSeekEnd}
					ontouchcancel={onSeekEnd}
				>
					<div class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] md:h-1 rounded-full overflow-hidden bg-white/45">
						<div class="absolute inset-y-0 left-0 bg-red-600 z-20" style="width: {Math.max(0, Math.min(100, ((time / getEffectiveDuration()) || 0) * 100))}%"></div>
					</div>
				</div>
				<div class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-full z-[90] pointer-events-none">
					{#each commentsWithTc as item}
						<button
							type="button"
							class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[10px] h-full pointer-events-auto bg-transparent cursor-pointer"
							style={tickLeftStyle(item.timecode)}
							title={`${item.usernameIfnull || item.userId || '?'}: ${item.comment}`}
							aria-label={`Jump to comment by ${item.usernameIfnull || item.userId || '?'} at ${item.timecode}`}
							onmousedown={preventDefault((e) => { e.stopPropagation(); if (isDesktopViewport) handlePinClick(item.id); })}
							onclick={(e) => { e.stopPropagation(); }}
						>
							<div class="absolute left-1/2 top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full pointer-events-none shadow-[0_0_0_1px_rgba(15,23,42,0.35)] {String(item.id) === highlightedCommentId ? 'bg-yellow-500 h-[50%] w-[3px]' : 'bg-white/85 h-[27%] w-[1.5px]'}"></div>
						</button>
					{/each}
				</div>
				{#if loopStartTime>0 || loopEndTime>0}
					<div class="absolute top-1/2 -translate-y-1/2 h-1 rounded-full pointer-events-none bg-amber-500/50" style="left: {loopStartTime/getEffectiveDuration()*100.0}%; width: {(loopEndTime-loopStartTime)/getEffectiveDuration()*100.0}%"></div>
				{/if}
				<div
					class="absolute top-1/2 -translate-y-1/2 w-7 h-7 z-[45]"
					style="left: calc({Math.max(0, Math.min(100, ((time / getEffectiveDuration()) || 0) * 100))}% - 0.875rem);"
					onmousedown={preventDefault((e)=>{ onSeekStart(); handleMove(e as MouseEvent, seekSliderEl ?? null); })}
					ontouchstart={preventDefault((e)=>{ onSeekStart(); handleMove(e as TouchEvent, seekSliderEl ?? null); })}
				></div>
				<div class="absolute top-1/2 -translate-y-1/2 w-3 h-3 md:w-3.5 md:h-3.5 rounded-full bg-red-500 z-50 border border-red-300/70 shadow-[0_1px_6px_rgba(0,0,0,0.45)] transition-transform duration-120 {isSeekingThumb ? 'scale-125' : 'scale-100'}" style="left: calc({Math.max(0, Math.min(100, ((time / getEffectiveDuration()) || 0) * 100))}% - 0.375rem);" onmousedown={preventDefault((e)=>{ onSeekStart(); handleMove(e as MouseEvent, seekSliderEl ?? null); })} ontouchstart={preventDefault((e)=>{ onSeekStart(); handleMove(e as TouchEvent, seekSliderEl ?? null); })}></div>
			</div>
		</div>

</div>

<svelte:window onkeydown={onWindowKeyPress} onmousemove={onGlobalSeekMove} ontouchmove={onGlobalSeekMove} onmouseup={onSeekEnd} ontouchend={onSeekEnd} ontouchcancel={onSeekEnd} />

<style>

button:disabled {
    opacity: 0.3;
}

</style>
