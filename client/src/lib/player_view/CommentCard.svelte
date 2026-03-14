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
        ondisplaycomment?: (event: {timecode: string, drawing?: string, subtitleId?: string}) => void;
        ondeletecomment?: (event: {id: string}) => void;
        onreplytocomment?: (event: {parentId: string, commentText: string, subtitleId?: string}) => void;
        oneditcomment?: (event: {id: string, comment_text: string}) => void;
    }

    let { indent = 0, comment, ondisplaycomment, ondeletecomment, onreplytocomment, oneditcomment }: Props = $props();

let editing = $state(false);
let showReply: boolean = $state(false);
let replyInput: HTMLInputElement | undefined = $state();

const SWIPE_ACTION_WIDTH = 84;
let swipeOffsetPx = $state(0);
let swipeStartX = $state(0);
let swipeStartY = $state(0);
let swipeStartOffsetPx = $state(0);
let swipeActive = $state(false);
let swipeDidMove = $state(false);

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
    if (editing) {
        editing = false;
        commentText = commentText.trim();
        comment.comment = commentText;
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

function openSwipeActions() {
    swipeOffsetPx = -maxSwipePx;
}

function onCardTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
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

    // Prefer vertical scrolling unless horizontal intent is clear.
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        swipeActive = false;
        return;
    }

    if (Math.abs(dx) > 6) {
        swipeDidMove = true;
        e.preventDefault();
    }

    const next = swipeStartOffsetPx + dx;
    swipeOffsetPx = Math.max(-maxSwipePx, Math.min(0, next));
}

function onCardTouchEnd() {
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

function onClickShare() {
    // Build a simple fragment link to this comment
    try {
        const base = window.location.href.split('#')[0];
        const url = `${base}#comment_${comment.id}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => {
                alert($t('comments.linkCopied'));
            }).catch(() => { alert($t('comments.copyLink') + ": " + url); });
        } else { alert($t('comments.copyLink') + ": " + url); }
    } catch (e) {
        console.error('Failed to copy link', e);
    }
}

</script>

<div transition:scale class="comment-indent-shell w-full min-w-0 box-border" style="padding-left: {indent*1.5}em;">
<div class="relative w-full min-w-0 overflow-hidden rounded-lg border border-slate-700/70">
    <div class="absolute inset-y-0 right-0 z-0 flex items-stretch">
        <button
            class="w-[84px] text-white text-sm font-semibold bg-sky-600 active:bg-sky-700"
            onclick={(e) => { e.stopPropagation(); closeSwipeActions(); showReply = true; }}
        >{$t('comments.reply')}</button>
        {#if canEdit}
            <button
                class="w-[84px] text-white text-sm font-semibold bg-amber-500 active:bg-amber-600"
                onclick={(e) => { e.stopPropagation(); closeSwipeActions(); editing = true; }}
            >{$t('comments.edit')}</button>
        {/if}
        {#if canDelete}
            <button
                class="w-[84px] text-white text-sm font-semibold bg-red-500 active:bg-red-600"
                onclick={(e) => { e.stopPropagation(); closeSwipeActions(); onClickDeleteComment(); }}
            >{$t('comments.deleteShort')}</button>
        {/if}
    </div>

    <div
        id="comment_card_{comment.id}"
        class="relative z-10 block box-border w-full min-w-0 max-w-full overflow-hidden text-ellipsis bg-gray-800 {!!comment.timecode ? 'hover:bg-gray-700' : ''}"
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

        <div class="flex mx-2 pt-3 min-w-0">
            <div class="flex-none w-10 h-10 md:w-9 md:h-9 block"><Avatar username={comment.userId || comment.usernameIfnull}/></div>
            <h5 class="flex-1 min-w-0 ml-3 text-gray-500 self-end truncate">{comment.usernameIfnull}</h5>
            <span class="flex-none hidden text-xs font-mono">[{comment.id}@{comment.parentId}]</span>
            <span class="pl-2 flex-none max-w-[45%] text-xs text-right overflow-hidden text-ellipsis italic whitespace-nowrap self-end">
                    <span class="text-yellow-700 hover:text-yellow-500 hover:underline cursor-pointer">
                        {comment.timecode ? comment.timecode : ""}
                    </span>
                    {#if comment.subtitleId}
                        <span class="text-xs text-gray-500 text-nowrap text-ellipsis">| <strong>{getSubtitleLanguage(comment.subtitleId)}</strong></span>
                    {:else if comment.subtitleFilenameIfnull}
                        <br/><span class="text-xs text-gray-500 line-through" title={comment.subtitleFilenameIfnull}>{comment.subtitleFilenameIfnull}</span>
                    {/if}
            </span>
        </div>

        <div class="p-2" lang="en">
            {#if editing}
                <textarea class="w-full outline-dashed bg-slate-500" rows=3 use:callFocus bind:value={commentText} onkeydown={onEditFieldKeyDown} onblur={onEditFieldBlur}></textarea>
            {:else}
                <p class="text-gray-300 text-base hyphenate">
                    {comment.comment}
                    {#if comment.edited}
                        <span class="text-xs italic text-gray-500"> {$t('comments.editedSuffix')}</span>
                    {/if}
                </p>
            {/if}
        </div>

        <div class="px-2 pb-2 flex justify-end">
            <button
                class="fa fa-link border rounded-lg px-2 py-1 text-sm h-9 border-gray-500 text-gray-300 hover:bg-gray-700"
                title={$t('comments.copyLink')}
                aria-label={$t('comments.copyLink')}
                onclick={(e) => { e.stopPropagation(); onClickShare(); }}
            ></button>
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
