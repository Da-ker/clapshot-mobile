<script lang="ts">
    import { flushSync, tick } from 'svelte';


import { scale } from "svelte/transition";
import Avatar from '@/lib/Avatar.svelte';
import { curUserId, curUserIsAdmin, allComments, curSubtitle, curVideo } from '@/stores';
import * as Proto3 from '@clapshot_protobuf/typescript';
import { t } from '@/i18n';
import { get } from 'svelte/store';

const displayUsername = (name?: string | null) => ((name || '').trim().toLowerCase() === 'docker' ? get(t)('general.guest') : (name || ''));


    interface Props {
        indent?: number;
        comment: Proto3.Comment;
        ondisplaycomment?: (event: {id: string, timecode: string, drawing?: string, subtitleId?: string}) => void;
        ondeletecomment?: (event: {id: string}) => void;
        onreplytocomment?: (event: {parentId: string, commentText: string, subtitleId?: string}) => void;
        oneditcomment?: (event: {id: string, comment_text: string}) => void;
    }

    let { indent = 0, comment, ondisplaycomment, ondeletecomment, onreplytocomment, oneditcomment }: Props = $props();

let editing = $state(false);
let showReply: boolean = $state(false);
let replyInput: HTMLInputElement | undefined = $state();
let replyText = $state('');

const SWIPE_ACTION_WIDTH = 74;
const COMPLETED_TOKEN = '__CS_DONE__';
const LEGACY_COMPLETED_TOKEN = '[[CLAPSHOT_DONE]]';
let swipeOffsetPx = $state(0);
let swipeStartX = $state(0);
let swipeStartY = $state(0);
let swipeStartOffsetPx = $state(0);
let swipeActive = $state(false);
let swipeDidMove = $state(false);
let swipeScrollLockEl: HTMLElement | null = null;
let swipeScrollLockPrevOverflow = '';

const canEdit = $derived(comment.userId == $curUserId || $curUserIsAdmin);
const canDelete = $derived(canEdit);
const swipeActionCount = $derived(1 + (canEdit ? 1 : 0) + (canDelete ? 1 : 0));
const maxSwipeLeftPx = $derived(swipeActionCount * SWIPE_ACTION_WIDTH);
const canComplete = $derived(indent === 0);
const maxSwipeRightPx = $derived(canComplete ? SWIPE_ACTION_WIDTH : 0);

const isCompleted = $derived(canComplete && ((comment.comment || '').includes(COMPLETED_TOKEN) || (comment.comment || '').includes(LEGACY_COMPLETED_TOKEN)));
const hasCompletedAncestor = $derived.by(() => {
    let parentId = comment.parentId;
    while (parentId) {
        const parent = $allComments.find((c) => c.comment.id === parentId)?.comment;
        if (!parent) return false;
        const parentCompleted = ((parent.comment || '').includes(COMPLETED_TOKEN) || (parent.comment || '').includes(LEGACY_COMPLETED_TOKEN));
        if (parentCompleted) return true;
        parentId = parent.parentId;
    }
    return false;
});

let contextMenuOpen = $state(false);
let contextMenuX = $state(0);
let contextMenuY = $state(0);
let contextMenuEl: HTMLDivElement | null = $state(null);
let contextMenuSuppressClickUntil = $state(0);
const CONTEXT_MENU_OPEN_EVENT = 'clapshot-comment-context-menu-open';

function stripCompletedToken(text: string): string {
    return (text || '').replace(COMPLETED_TOKEN, '').replace(LEGACY_COMPLETED_TOKEN, '').trim();
}

function withCompletedToken(text: string, completed: boolean): string {
    const base = stripCompletedToken(text);
    return completed ? `${base} ${COMPLETED_TOKEN}`.trim() : base;
}

let commentText = $state(stripCompletedToken(comment.comment || ''));

$effect(() => {
    commentText = stripCompletedToken(comment.comment || '');
});

$effect(() => {
    if (editing) closeSwipeActions();
});

$effect(() => {
    if (typeof window === 'undefined') return;

    const onOtherMenuOpened = (event: Event) => {
        const detail = (event as CustomEvent<{ commentId?: string }>).detail;
        if (!detail?.commentId) return;
        if (detail.commentId === comment.id) return;
        closeContextMenu();
    };

    window.addEventListener(CONTEXT_MENU_OPEN_EVENT, onOtherMenuOpened as EventListener);
    return () => {
        window.removeEventListener(CONTEXT_MENU_OPEN_EVENT, onOtherMenuOpened as EventListener);
    };
});

function onTimecodeClick(tc: string) {
    if (ondisplaycomment) ondisplaycomment({
        id: comment.id,
        timecode: tc,
        drawing: comment.drawing,
        subtitleId: comment.subtitleId
    });
}

function getDescendantIds(rootId: string): string[] {
    const byParent = new Map<string, string[]>();
    for (const c of $allComments) {
        const pid = c.comment.parentId;
        if (!pid) continue;
        const arr = byParent.get(pid) ?? [];
        arr.push(c.comment.id);
        byParent.set(pid, arr);
    }

    const descendants: string[] = [];
    const stack: string[] = [...(byParent.get(rootId) ?? [])];
    while (stack.length > 0) {
        const id = stack.pop()!;
        descendants.push(id);
        const children = byParent.get(id) ?? [];
        for (const childId of children) stack.push(childId);
    }
    return descendants;
}

function onClickDeleteComment() {
    const descendantCount = getDescendantIds(comment.id).length;
    const confirmText = descendantCount > 0
        ? `将删除此评论及 ${descendantCount} 条回复，是否继续？`
        : $t('comments.deleteConfirm');
    const result = confirm(confirmText);
    if (result && ondeletecomment) {
        ondeletecomment({ id: comment.id });
    }
}

function onReplySubmit() {
    const nextText = replyText.trim();
    if (nextText !== '' && onreplytocomment) {
        onreplytocomment({
            parentId: comment.id,
            commentText: nextText,
            subtitleId: $curSubtitle?.id
        });
    }
    replyText = '';
    showReply = false;
}

function onReplyFieldBlur() {
    // Safari/iOS keyboard accessory "✓" often triggers blur without submit.
    // If user already typed content, treat blur as submit for better UX.
    setTimeout(() => {
        if (!showReply) return;
        const activeEl = document.activeElement as HTMLElement | null;
        if (activeEl?.closest?.(`#reply_form_${comment.id}`)) return;
        if (replyText.trim() !== '') onReplySubmit();
        else showReply = false;
    }, 0);
}

function callFocus(elem: HTMLElement) {
    elem.focus();
}

function onEditFieldKeyDown(e: KeyboardEvent) {
    if ((e.key == "Enter" && !e.shiftKey) || e.key == "Escape") {
        e.preventDefault();
        e.stopPropagation();
        flushSync(() => {
            editing = false;
        });
        commentText = commentText.trim();
        if (commentText != "" && oneditcomment) {
            const nextStored = withCompletedToken(commentText, isCompleted);
            comment.comment = nextStored;
            oneditcomment({'id': comment.id, 'comment_text': nextStored});
        }
    }
}

function onEditFieldBlur() {
    if (!editing) return;
    editing = false;

    const nextText = commentText.trim();
    const currentVisibleText = stripCompletedToken(comment.comment || '');
    if (nextText === '') {
        commentText = currentVisibleText;
        return;
    }

    if (nextText !== currentVisibleText && oneditcomment) {
        const nextStored = withCompletedToken(nextText, isCompleted);
        comment.comment = nextStored;
        oneditcomment({ id: comment.id, comment_text: nextStored });
    }
}

function getSubtitleLanguage(subtitleId: string): string {
    let sub = $curVideo?.subtitles.find(s => s.id == subtitleId);
    return sub ? sub.languageCode.toUpperCase() : "";
}

function closeSwipeActions() {
    swipeOffsetPx = 0;
}

function openLeftSwipeActions() {
    swipeOffsetPx = -maxSwipeLeftPx;
}

function openRightSwipeActions() {
    swipeOffsetPx = maxSwipeRightPx;
}

function onClickToggleComplete() {
    if (!canComplete || !oneditcomment) return;
    const nextCompleted = !isCompleted;
    const nextStored = withCompletedToken(comment.comment || '', nextCompleted);
    comment.comment = nextStored;
    oneditcomment({ id: comment.id, comment_text: nextStored });
    closeSwipeActions();
}

function lockCommentListScroll() {
    if (swipeScrollLockEl) return;
    swipeScrollLockEl = (document.getElementById(`comment_card_${comment.id}`)?.closest('[data-comments-scroll]') as HTMLElement | null) ?? null;
    if (!swipeScrollLockEl) return;
    swipeScrollLockPrevOverflow = swipeScrollLockEl.style.overflowY || '';
    swipeScrollLockEl.style.overflowY = 'hidden';
}

function unlockCommentListScroll() {
    if (!swipeScrollLockEl) return;
    swipeScrollLockEl.style.overflowY = swipeScrollLockPrevOverflow;
    swipeScrollLockEl = null;
    swipeScrollLockPrevOverflow = '';
}


function onCardTouchStart(e: TouchEvent) {
    if (editing) return;
    const t = e.touches[0];
    if (!t) return;
    unlockCommentListScroll();
    swipeActive = true;
    swipeDidMove = false;
    swipeStartX = t.clientX;
    swipeStartY = t.clientY;
    swipeStartOffsetPx = swipeOffsetPx;
}

function onCardTouchMove(e: TouchEvent) {
    if (editing) return;
    if (!swipeActive) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - swipeStartX;
    const dy = t.clientY - swipeStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Let vertical scrolling win unless horizontal intention is clearly stronger.
    const horizontalIntent = absDx > 12 && absDx > absDy + 4;
    const verticalIntent = absDy > 8 && absDy > absDx;

    if (verticalIntent && !swipeDidMove) {
        swipeActive = false;
        unlockCommentListScroll();
        return;
    }

    if (horizontalIntent || swipeDidMove) {
        swipeDidMove = true;
        lockCommentListScroll();
        // While actively swiping card horizontally, lock parent vertical scroll.
        e.preventDefault();
    } else {
        return;
    }

    const next = swipeStartOffsetPx + dx;
    swipeOffsetPx = Math.max(-maxSwipeLeftPx, Math.min(maxSwipeRightPx, next));
}

function onCardTouchEnd() {
    unlockCommentListScroll();
    if (!swipeDidMove) {
        swipeActive = false;
        return;
    }

    const leftThreshold = Math.min(56, maxSwipeLeftPx / 3);
    const rightThreshold = Math.min(36, maxSwipeRightPx / 2);

    if (swipeStartOffsetPx < 0) {
        const rightSwipeDistance = swipeOffsetPx - swipeStartOffsetPx;
        if (rightSwipeDistance > 10) closeSwipeActions();
        else if (swipeOffsetPx <= -leftThreshold) openLeftSwipeActions();
        else closeSwipeActions();
    } else if (swipeStartOffsetPx > 0) {
        const leftSwipeDistance = swipeStartOffsetPx - swipeOffsetPx;
        if (leftSwipeDistance > 10) closeSwipeActions();
        else if (swipeOffsetPx >= rightThreshold) openRightSwipeActions();
        else closeSwipeActions();
    } else {
        if (swipeOffsetPx <= -leftThreshold) openLeftSwipeActions();
        else if (swipeOffsetPx >= rightThreshold) openRightSwipeActions();
        else closeSwipeActions();
    }

    swipeActive = false;
}

function onCardClick(e?: MouseEvent) {
    if (contextMenuSuppressClickUntil > Date.now()) return;
    if (e && e.button !== 0) return;
    if (contextMenuOpen) return;
    if (showReply || editing) return;
    if (swipeDidMove) {
        swipeDidMove = false;
        return;
    }
    if (swipeOffsetPx !== 0) {
        closeSwipeActions();
        return;
    }
    if (comment.timecode) onTimecodeClick(comment.timecode);
}

async function openContextMenuAt(x: number, y: number) {
    closeSwipeActions();
    contextMenuSuppressClickUntil = Date.now() + 320;

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(CONTEXT_MENU_OPEN_EVENT, {
            detail: { commentId: comment.id }
        }));
    }

    const margin = 8;
    const fallbackW = 168;
    const fallbackH = 176;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;

    contextMenuX = vw > 0 ? Math.max(margin, Math.min(x, vw - fallbackW - margin)) : x;
    contextMenuY = vh > 0 ? Math.max(margin, Math.min(y, vh - fallbackH - margin)) : y;
    contextMenuOpen = true;

    await tick();
    if (contextMenuEl && vw > 0 && vh > 0) {
        const rect = contextMenuEl.getBoundingClientRect();
        contextMenuX = Math.max(margin, Math.min(contextMenuX, vw - rect.width - margin));
        contextMenuY = Math.max(margin, Math.min(contextMenuY, vh - rect.height - margin));
        // Render in Top Layer when supported to bypass clipping/stacking contexts.
        try {
            const anyEl = contextMenuEl as unknown as { showPopover?: () => void };
            if (anyEl.showPopover) {
                anyEl.showPopover();
            }
        } catch {}
    }
}

function onCardContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    openContextMenuAt(e.clientX, e.clientY);
}

function closeContextMenu() {
    if (contextMenuEl) {
        try {
            const anyEl = contextMenuEl as unknown as { hidePopover?: () => void; matches?: (q: string) => boolean };
            if (anyEl.hidePopover && anyEl.matches?.(':popover-open')) anyEl.hidePopover();
        } catch {}
    }
    contextMenuOpen = false;
    contextMenuEl = null;
}

function onContextReply() {
    closeContextMenu();
    replyText = '';
    showReply = true;
}

function onContextEdit() {
    closeContextMenu();
    editing = true;
}

function onContextDelete() {
    closeContextMenu();
    onClickDeleteComment();
}

function onContextComplete() {
    closeContextMenu();
    onClickToggleComplete();
}

function onGlobalPointerDownForContextMenu(e: MouseEvent) {
    if (!contextMenuOpen) return;
    // Ignore right-button down so opening by right click won't be closed immediately.
    if (e.button === 2) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('[data-comment-context-menu="1"]')) return;
    closeContextMenu();
}


</script>

<svelte:window onmousedown={onGlobalPointerDownForContextMenu} />

<div transition:scale class="comment-indent-shell w-full min-w-0 box-border" style="padding-left: {indent*1.25}em;">
<div class="relative w-full min-w-0 rounded-xl border shadow-[0_2px_10px_rgba(0,0,0,0.18)] overflow-hidden {isCompleted || hasCompletedAncestor ? 'border-slate-900/85 bg-slate-950/82' : (indent > 0 ? 'border-slate-700/80 bg-slate-900/35 border-l-[3px] border-l-slate-500/80' : 'border-slate-700/60')}">
    {#if canComplete}
    <div class="absolute inset-y-0 left-0 z-0 flex items-stretch transition-opacity {swipeOffsetPx > 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}">
        <button
            class="w-[74px] text-white text-sm font-semibold bg-teal-500 active:bg-teal-600"
            onclick={(e) => { e.stopPropagation(); onClickToggleComplete(); }}
        >{isCompleted ? $t('comments.uncomplete') : $t('comments.complete')}</button>
    </div>
    {/if}

    <div class="absolute inset-y-0 right-0 z-0 flex items-stretch transition-opacity {swipeOffsetPx < 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}">
        <button
            class="w-[74px] text-white text-sm font-semibold bg-sky-600 active:bg-sky-700"
            onclick={(e) => { e.stopPropagation(); closeSwipeActions(); replyText = ''; showReply = true; }}
        >{$t('comments.reply')}</button>
        {#if canEdit}
            <button
                class="w-[74px] text-white text-sm font-semibold bg-amber-500 active:bg-amber-600"
                onclick={(e) => { e.stopPropagation(); closeSwipeActions(); editing = true; }}
            >{$t('comments.edit')}</button>
        {/if}
        {#if canDelete}
            <button
                class="w-[74px] text-white text-sm font-semibold bg-red-500 active:bg-red-600"
                onclick={(e) => { e.stopPropagation(); closeSwipeActions(); onClickDeleteComment(); }}
            >{$t('comments.deleteShort')}</button>
        {/if}
    </div>

    <div
        id="comment_card_{comment.id}"
        class="relative z-10 block box-border w-full min-w-0 max-w-full overflow-hidden text-ellipsis bg-gradient-to-b {isCompleted || hasCompletedAncestor ? 'from-[#08101c] to-[#101a2b] hover:from-[#0c1624] hover:to-[#162235]' : 'from-slate-800 to-slate-900'} {!!comment.timecode && !isCompleted && !hasCompletedAncestor ? 'hover:from-slate-700 hover:to-slate-800' : ''}"
        tabindex="0"
        role="link"
        style="transform: translateX({swipeOffsetPx}px); transition: {swipeActive ? 'none' : 'transform 180ms ease-out'};"
        ontouchstart={onCardTouchStart}
        ontouchmove={onCardTouchMove}
        ontouchend={onCardTouchEnd}
        ontouchcancel={onCardTouchEnd}
        onclick={onCardClick}
        oncontextmenu={onCardContextMenu}
        onkeydown={(e) => {
            if (e.key == "Escape") { editing = false; closeSwipeActions(); closeContextMenu(); }
            else if (e.key == "Enter") { onCardClick(); }
        }}
    >
        <div class="flex items-start px-2.5 py-2 min-w-0 gap-2" lang="en">
            <div class="flex-none w-8 h-8 md:w-8 md:h-8 block"><Avatar username={comment.userId || comment.usernameIfnull}/></div>
            {#if editing}
                <div class="flex-1 min-w-0">
                    <textarea class="w-full outline-dashed bg-slate-500" rows=3 use:callFocus bind:value={commentText} onkeydown={onEditFieldKeyDown} onblur={onEditFieldBlur}></textarea>
                </div>
            {:else}
                <p class="flex-1 min-w-0 text-sm leading-5 whitespace-normal break-words">
                    <span class="text-slate-400">{displayUsername(comment.usernameIfnull)}</span>
                    <span class="text-slate-500">：</span>
                    <span class="text-slate-200">{stripCompletedToken(comment.comment || '')}</span>

                </p>
            {/if}
            <span class="flex-none hidden text-xs font-mono">[{comment.id}@{comment.parentId}]</span>
            <span class="flex-none text-[11px] text-right italic whitespace-nowrap leading-5 pl-1">
                    <span class="text-amber-400/90 hover:text-amber-300 hover:underline cursor-pointer">
                        {comment.timecode ? comment.timecode : ""}
                    </span>
                    {#if comment.subtitleId}
                        <span class="text-xs text-gray-500">| <strong>{getSubtitleLanguage(comment.subtitleId)}</strong></span>
                    {:else if comment.subtitleFilenameIfnull}
                        <span class="text-xs text-gray-500 line-through" title={comment.subtitleFilenameIfnull}>| {comment.subtitleFilenameIfnull}</span>
                    {/if}
            </span>
        </div>

        {#if showReply}
        <form
            id="reply_form_{comment.id}"
            class="p-2"
            onsubmit={(e) => { e.preventDefault(); e.stopPropagation(); onReplySubmit(); }}
        >
                <div class="flex items-center gap-2 rounded-md border border-sky-500/45 bg-slate-900/70 p-1.5">
                    <input
                        class="flex-1 border p-1 rounded bg-gray-900"
                        type="text"
                        placeholder={$t('comments.yourReply')}
                        enterkeyhint="send"
                        use:callFocus
                        bind:this={replyInput}
                        bind:value={replyText}
                        onblur={onReplyFieldBlur}
                    />
                </div>
            </form>
        {/if}
    </div>
</div>
</div>

{#if contextMenuOpen}
<div
    bind:this={contextMenuEl}
    popover="manual"
    data-comment-context-menu="1"
    class="fixed z-[1200] min-w-[120px] rounded-lg border border-slate-600 bg-slate-900/95 shadow-[0_6px_20px_rgba(0,0,0,0.45)] backdrop-blur-sm p-1"
    style="left: {contextMenuX}px; top: {contextMenuY}px; margin: 0;"
    onclick={(e) => e.stopPropagation()}
>
    {#if canComplete}
        <button class="w-full text-left px-3 py-1.5 rounded hover:bg-slate-700 text-sm text-teal-300" onclick={onContextComplete}>{isCompleted ? $t('comments.uncomplete') : $t('comments.complete')}</button>
    {/if}
    <button class="w-full text-left px-3 py-1.5 rounded hover:bg-slate-700 text-sm text-sky-300" onclick={onContextReply}>{$t('comments.reply')}</button>
    {#if canEdit}
        <button class="w-full text-left px-3 py-1.5 rounded hover:bg-slate-700 text-sm text-amber-300" onclick={onContextEdit}>{$t('comments.edit')}</button>
    {/if}
    {#if canDelete}
        <button class="w-full text-left px-3 py-1.5 rounded hover:bg-slate-700 text-sm text-red-300" onclick={onContextDelete}>{$t('comments.deleteShort')}</button>
    {/if}
</div>
{/if}

<style>
button {
    cursor: pointer;
}
</style>
