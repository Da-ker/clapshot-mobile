<script lang="ts">
    import { preventDefault } from 'svelte/legacy';

import '@fortawesome/fontawesome-free/css/all.min.css';
import { fade } from "svelte/transition";

import { videoIsReady } from '@/stores';
import { t } from '@/i18n';


interface Props {
    onbuttonclicked?: (event: {action: string, comment_text?: string, is_timed?: boolean, is_draw_mode?: boolean, color?: string}) => void;
}

let { onbuttonclicked }: Props = $props();

let inputText: any = $state();
let drawMode = $state(false);
let timedComment = $state(true);

const DRAW_PALETTE_KEY = 'clapshot:draw-palette-selection:v1';
function getSavedPaletteSelection(): string {
    try {
        return localStorage.getItem(DRAW_PALETTE_KEY) || 'red';
    } catch {
        return 'red';
    }
}
function setSavedPaletteSelection(v: string) {
    try {
        localStorage.setItem(DRAW_PALETTE_KEY, v);
    } catch {
        // ignore
    }
}

let curColor = $state(getSavedPaletteSelection());

export function forceDrawMode(on: boolean) {
    drawMode = on;
}

function sendDrawModeToParent() {
    if (onbuttonclicked) onbuttonclicked({'action': 'draw', 'is_draw_mode': drawMode});
}
function onClickSend() {
    if (onbuttonclicked) onbuttonclicked({'action': 'send', 'comment_text': inputText, 'is_timed': timedComment});
    inputText = "";
    drawMode = false;
    sendDrawModeToParent();
}
function onClickDraw() {
    drawMode = !drawMode;
    if (drawMode) { timedComment = true; }  // Drawings make no sense without a timecode.
    sendDrawModeToParent();
}
function onColorSelected(c: string) {
    curColor = c;
    setSavedPaletteSelection(c);
    if (onbuttonclicked) onbuttonclicked({'action': 'color_select', 'color': c});
}
function onClearDrawing() {
    if (onbuttonclicked) {
        onbuttonclicked({ 'action': 'clear_drawing' });
    }
}

function onTextChange(e: any) {
    if (e.target.value.length > 0 && onbuttonclicked) {
        onbuttonclicked({'action': 'text_input'});
    }
    return false;
}

</script>


<div class="relative">
    <!-- Color selector -->
    {#if drawMode}
        <div class="absolute w-full top-[-3.4em] bg-gray-900 h-12 rounded-md flex items-center place-content-center" transition:fade="{{duration: 100}}">
            <button
                type="button"
                class="border border-gray-600 inline-flex items-center justify-center w-6 h-6 m-2 rounded-lg bg-gray-700 hover:bg-gray-600 active:bg-gray-500"
                title="清除标注"
                aria-label="Clear drawings"
                onclick={onClearDrawing}
            >
                <i class="fas fa-trash text-[11px] text-gray-200"></i>
            </button>

            {#each ["red", "green", "blue", "cyan", "yellow", "black", "white"] as c}
                <button type="button" class="{(curColor==c) ? 'border-2 border-gray-100' : 'border border-gray-600'} inline-block w-6 h-6 m-2 rounded-lg" style="background: {c};" aria-label="Select {c} color" onclick={() => onColorSelected(c)}></button>
            {/each}
        </div>
    {/if}

    <form onsubmit={preventDefault(onClickSend)} class="flex justify-left rounded-lg shadow-lg bg-gray-800 text-left p-2 w-full" >

        <input
            bind:value={inputText}
            oninput={onTextChange}
            class="flex-1 p-2 bg-gray-700 rounded-lg" placeholder={timedComment ? $t('comments.placeholderTimed') : $t('comments.placeholderUntimed')} />

        {#if $videoIsReady}
            <button type="button"
                id="timedCommentButton"
                title={$t('comments.timedToggleTitle')}
                class="scale-90 {timedComment ? 'text-amber-600' : 'text-gray-500'}"
                disabled={drawMode}
                onclick={() => timedComment = !timedComment}>
                <span class="fa-stack">
                    <i class="fa-solid fa-stopwatch fa-stack-2x"></i>
                    {#if !timedComment}
                        <i class="fa-solid fa-x fa-stack-2x text-red-800"></i>
                    {/if}
                </span>
            </button>

            <button type="button"
                onclick={onClickDraw}
                class="{drawMode ? 'border-2' : ''} fas fa-pen-fancy inline-block h-9 px-3 py-2.5 ml-2 bg-cyan-700 text-white rounded-lg shadow-md hover:bg-cyan-500 hover:shadow-lg focus:bg-cyan-700 focus:shadow-lg focus:outline-none focus:ring-0 active:shadow-lg transition duration-150 ease-in-out"
                title={$t('comments.drawOnVideo')} aria-label={$t('comments.drawOnVideo')}>
            </button>
        {/if}

        <button type="submit"
            id="sendButton"
            disabled={!inputText && !drawMode}
            class="inline-block h-9 px-4 py-2 ml-2 text-sm bg-blue-700 text-white rounded-lg shadow-md hover:bg-blue-500 hover:shadow-lg focus:bg-blue-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-blue-800 active:shadow-lg transition duration-150 ease-in-out">
            {$t('comments.send')}
        </button>

    </form>
</div>


<style>

button {
    transition: 0.1s ease-in-out;
}
#sendButton:disabled {
    opacity: 0.5;
    background-color: gray;
}
#timedCommentButton:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>
