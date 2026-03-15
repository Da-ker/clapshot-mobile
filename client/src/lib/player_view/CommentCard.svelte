<script lang="ts">
    import { flushSync } from 'svelte';


import { scale } from "svelte/transition";
import Avatar from '@/lib/Avatar.svelte';
import { curUserId, curUserIsAdmin, allComments, curSubtitle, curVideo } from '@/stores';
import * as Proto3 from '@clapshot_protobuf/typescript';
import { t } from '@/i18n';


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

const SWIPE_ACTION_WIDTH = 74;
let swipeOffsetPx = $state(0);
let swipeStartX = $state(0);
let swipeStartY = $state(0);
let swipeStartOffsetPx = $state(0);
let swipeActive = $state(false);
let swipeDidMove = $state(false);
let swipeScrollLockEl: HTMLElement | null = null;
let swipeScrollLockPrevOverflow = '';

const canEdit = $derived(comment.userId == $curUserId || $curUserIsAdmin);
const canDelete = $derived(canEdit && !hasChildren());
const swipeActionCount = $derived(1 + (canEdit ? 1 : 0) + (canDelete ? 1 : 0));
const maxSwipePx = $derived(swipeActionCount * SWIPE_ACTION_WIDTH);

let commentText = $state(comment.comment);

$effect(() => {
    commentText = comment.comment;
});

function onTimecodeClick(tc: string) {
    if (ondisplaycomment) ondisplaycomment({
        id: comment.id,
        timecode: tc,
        drawing: comment.drawing,
        subtitleId: comment.subtitleId
    });
}

function onClickDeleteComment() {
    var result = confirm($t('comments.deleteConfirm'));
    if (result && ondeletecomment) {
        ondeletecomment({'id': comment.id});
    }
}

function onReplySubmit() {
    if (replyInput && replyInput.value != "" && onreplytocomment)
    {
        onreplytocomment({
            parentId: comment.id,
            commentText: replyInput.value,
            subtitleId: $curSubtitle?.id
        });
        replyInput.value = "";
        showReply = false;
    }
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
            comment.comment = commentText;
            oneditcomment({'id': comment.id, 'comment_text': commentText});
        }
    }
}

function onEditFieldBlur() {
    if (!editing) return;
    editing = false;

    const nextText = commentText.trim();
    if (nextText === '') {
        commentText = comment.comment;
        return;
    }

    if (nextText !== comment.comment && oneditcomment) {
        comment.comment = nextText;
        oneditcomment({ id: comment.id, comment_text: nextText });
    }
}

function hasChildren(): boolean {
    return $allComments.filter(c => c.comment.parentId == comment.id).length > 0;
}

function getSubtitleLanguage(subtitleId: string): string {
    let sub = $curVideo?.subtitles.find(s => s.id == subtitleId);
    return sub ? sub.languageCode.toUpperCase() : "";
}

function closeSwipeActions() {
    swipeOffsetPx = 0;
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

function openSwipeActions() {
    swipeOffsetPx = -maxSwipePx;
}

function onCardTouchStart(e: TouchEvent) {
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
    swipeOffsetPx = Math.max(-maxSwipePx, Math.min(0, next));
}

function onCardTouchEnd() {
    unlockCommentListScroll();
    if (!swipeDidMove) {
        swipeActive = false;
        return;
    }
    const threshold = Math.min(56, maxSwipePx / 3);
    if (Math.abs(swipeOffsetPx) > threshold) openSwipeActions();
    else closeSwipeActions();
    swipeActive = false;
}

function onCardClick() {
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


</script>

<div transition:scale class="comment-indent-shell w-full min-w-0 box-border" style="padding-left: {indent*1.5}em;">
<div class="relative w-full min-w-0 overflow-hidden rounded-xl border border-slate-700/60 shadow-[0_2px_10px_rgba(0,0,0,0.18)]">
    <div class="absolute inset-y-0 right-0 z-0 flex items-stretch">
        <button
            class="w-[74px] text-white text-sm font-semibold bg-sky-600 active:bg-sky-700"
            onclick={(e) => { e.stopPropagation(); closeSwipeActions(); showReply = true; }}
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
        class="relative z-10 block box-border w-full min-w-0 max-w-full overflow-hidden text-ellipsis bg-gradient-to-b from-slate-800 to-slate-900 {!!comment.timecode ? 'hover:from-slate-700 hover:to-slate-800' : ''}"
        tabindex="0"
        role="link"
        style="transform: translateX({swipeOffsetPx}px); transition: {swipeActive ? 'none' : 'transform 180ms ease-out'};"
        ontouchstart={onCardTouchStart}
        ontouchmove={onCardTouchMove}
        ontouchend={onCardTouchEnd}
        ontouchcancel={onCardTouchEnd}
        onclick={onCardClick}
        onkeydown={(e) => {
            if (e.key == "Escape") { editing = false; closeSwipeActions(); }
            else if (e.key == "Enter") { onCardClick(); }
        }}
    >

        <div class="flex items-center px-2.5 py-2 min-w-0 gap-2" lang="en">
            <div class="flex-none w-8 h-8 md:w-8 md:h-8 block"><Avatar username={comment.userId || comment.usernameIfnull}/></div>
            {#if editing}
                <div class="flex-1 min-w-0">
                    <textarea class="w-full outline-dashed bg-slate-500" rows=3 use:callFocus bind:value={commentText} onkeydown={onEditFieldKeyDown} onblur={onEditFieldBlur}></textarea>
                </div>
            {:else}
                <p class="flex-1 min-w-0 text-sm leading-5 truncate">
                    <span class="text-slate-400">{comment.usernameIfnull}</span>
                    <span class="text-slate-500">：</span>
                    <span class="text-slate-200">{comment.comment}</span>
                    {#if comment.edited}
                        <span class="text-xs italic text-gray-500"> {$t('comments.editedSuffix')}</span>
                    {/if}
                </p>
            {/if}
            <span class="flex-none hidden text-xs font-mono">[{comment.id}@{comment.parentId}]</span>
            <span class="flex-none max-w-[48%] text-[11px] text-right overflow-hidden text-ellipsis italic whitespace-nowrap leading-5">
                    <span class="text-amber-400/90 hover:text-amber-300 hover:underline cursor-pointer">
                        {comment.timecode ? comment.timecode : ""}
                    </span>
                    {#if comment.subtitleId}
                        <span class="text-xs text-gray-500 text-nowrap text-ellipsis">| <strong>{getSubtitleLanguage(comment.subtitleId)}</strong></span>
                    {:else if comment.subtitleFilenameIfnull}
                        <span class="text-xs text-gray-500 line-through" title={comment.subtitleFilenameIfnull}>| {comment.subtitleFilenameIfnull}</span>
                    {/if}
            </span>
        </div>

        {#if showReply}
        <form class="p-2" onsubmit={(e) => {e.preventDefault(); onReplySubmit();}}>
                <input
                    class="w-full border p-1 rounded bg-gray-900"
                    type="text" placeholder={$t('comments.yourReply')}
                    use:callFocus
                    bind:this={replyInput}
            onblur={()=>showReply=false} />
            </form>
        {/if}
    </div>
</div>
</div>

<style>
.hyphenate {
    -webkit-hyphens: auto;
    -moz-hyphens: auto;
    -ms-hyphens: auto;
    hyphens: auto;
    word-break: break-word;
}
button {
    cursor: pointer;
}

/* Aggressive overflow guard for narrow/mobile screens */
@media (max-width: 767px) {
    .comment-indent-shell {
        padding-left: 0 !important;
    }
}
</style>
