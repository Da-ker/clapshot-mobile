<script lang="ts">

import { onMount, onDestroy } from 'svelte';
import { curUsername, curUserPic, curVideo, mediaFileId, collabId, userMenuItems, latestProgressReports, clientConfig } from "@/stores";
import { t, availableLocales, locale, setLocale } from '@/i18n';
import { get } from 'svelte/store';

const displayUsername = (name?: string | null) => ((name || '').trim().toLowerCase() === 'docker' ? get(t)('general.guest') : (name || ''));
import Avatar from '@/lib/Avatar.svelte';
import type { MediaProgressReport } from '@/types';
import { Dropdown, DropdownItem, DropdownDivider, DropdownHeader } from 'flowbite-svelte';
import EDLImport from './tools/EDLImport.svelte';
import ExportDialog from './tools/comment-export/ExportDialog.svelte';
import { ChevronRightOutline } from 'flowbite-svelte-icons';
import { Modal } from 'flowbite-svelte';
import * as Proto3 from '@clapshot_protobuf/typescript';

interface Props {
    onbasicauthlogout?: () => void;
    onaddcomments?: (comments: Proto3.Comment[]) => void;
}

let { onbasicauthlogout, onaddcomments }: Props = $props();

let loggedOut = $state(false);
let localeOptions = $state(availableLocales);

// Watch for (transcoding) progress reports from server, and update progress bar if one matches this item.
let videoProgressMsg: string | undefined = $state(undefined);

onMount(async () => {
	latestProgressReports.subscribe((reports: MediaProgressReport[]) => {
		videoProgressMsg = reports.find((r: MediaProgressReport) => r.mediaFileId === $mediaFileId)?.msg;
	});
});

$effect(() => {
	if ($clientConfig?.supported_locales && $clientConfig.supported_locales.length > 0) {
		const allowed = new Set($clientConfig.supported_locales.map((l: string) => l.toLowerCase()));
		const filtered = availableLocales.filter((loc) => allowed.has(loc.id.toLowerCase()));
		localeOptions = filtered.length > 0 ? filtered : availableLocales;
	} else {
		localeOptions = availableLocales;
	}
});

function onLocaleChange(e: Event) {
	const newLocale = (e.target as HTMLSelectElement).value;
	setLocale(newLocale);
}



function logoutBasicAuth() {
    // This is a bit tricky, as HTTP basic auth wasn't really designed for logout.
    // Logout URL is expected to return 401 status code and return a Clear-Site-Data header.
    // Additionally, send bad credentials in case 401 and Clear-Site-Data wasn't enough to forget the credentials.
    // After that, disconnect websocket and show a modal to prompt user to reload the page.

    const logoutUrl = $clientConfig?.logout_url || "/logout";
	const nonce = Math.random().toString(36).substring(2, 15);

    console.log("Making request to " + logoutUrl + " with bad creds...");
    fetch(logoutUrl, {method:'GET', headers: {'Authorization': 'Basic ' + btoa('logout_user__'+nonce+':bad_pass__'+nonce)}})
        .then(res => {
            console.log("Logout response: " + res.status + " - " + res.statusText);
            if (res.status === 401) {
                console.log("Logout successful.");
				if (onbasicauthlogout) onbasicauthlogout();
				loggedOut = true;	// Show modal
            } else {
                alert("Basic auth logout failed.\nStatus code from " + logoutUrl + ": " + res.status + " (not 401)");
            }
        })
        .catch(error => {
            console.log("Error logging out: " + error);
        })
}

function showAbout() {
	const title = get(locale) === 'zh' ? 'Clapshot 客户端版本 ' : 'Clapshot Client version ';
	const visitText = get(locale) === 'zh' ? '项目地址：\n' : 'Visit the project page at:\n';
	alert(title + process.env.CLAPSHOT_CLIENT_VERSION + "\n" +
		"\n" +
		visitText +
		"https://github.com/elonen/clapshot\n");
}

async function copyToClipboard() {
	const urlParams = `?vid=${$mediaFileId}`;
	const currentUrl = window.location.href.split('?')[0]; // remove existing query parameters
	const fullUrl = currentUrl + urlParams;
	try {
		await navigator.clipboard.writeText(fullUrl);
		const copiedText = get(locale) === 'zh'
			? '链接已复制到剪贴板。\n请发送给已在此站点登录的审阅者。'
			: 'Link copied to clipboard.\nSend it to reviewers who have user accounts here.';
		alert(copiedText);
	} catch (err) {
		console.error('Failed to copy link: ', err);
	}
}

const randomSessionId = Math.random().toString(36).substring(2, 15);


let isEDLImportOpen = $state(false);
let isExportOpen = $state(false);
let isMobileViewport = $state(false);
let isMobileMediaMenuOpen = $state(false);

function updateViewport() {
	isMobileViewport = window.matchMedia('(max-width: 639px)').matches;
	if (!isMobileViewport) isMobileMediaMenuOpen = false;
}

function toggleMediaMenu() {
	if (isMobileViewport) {
		isMobileMediaMenuOpen = !isMobileMediaMenuOpen;
	}
}

function closeMobileMediaMenu() {
	isMobileMediaMenuOpen = false;
}

onMount(() => {
	updateViewport();
	window.addEventListener('resize', updateViewport, { passive: true });
});

onDestroy(() => {
	window.removeEventListener('resize', updateViewport);
});

function addEDLComments(comments: Proto3.Comment[]) {
	console.debug("addEDLComments", comments);
	if (onaddcomments) onaddcomments(comments);
}


</script>

<nav class="relative z-[120] px-3 sm:px-5 md:px-6 py-1 sm:py-1.5 md:py-2 rounded bg-gray-900/90 backdrop-blur-sm">

	<div class="flex items-center gap-2 sm:gap-3 flex-wrap md:flex-nowrap min-w-0">

		<!-- logo with "home" link -->
		<span class="shrink-0">
			<a href="/" class="flex items-baseline cursor-pointer">
				<img src="{$clientConfig ? ($clientConfig?.logo_url || "clapshot-logo.svg") : ""}" class="h-6 sm:h-8 filter brightness-75" alt="{$clientConfig ? ($clientConfig.app_title || "Clapshot") : ""}" />
			</a>
		</span>

		<!-- video info -->
		<div class="flex-1 min-w-0 flex justify-center">
			{#if $mediaFileId}
			<div class="inline-flex items-center gap-2 sm:gap-3 min-w-0 text-gray-400">
				<div class="min-w-0 text-center pt-1 sm:pt-1.5">
					<h2 class="text-sm sm:text-base min-w-0 text-gray-200 font-semibold truncate leading-none">{$curVideo?.title || $mediaFileId}</h2>
					<span class="text-[9px] sm:text-[10px] truncate font-mono text-gray-500 leading-none">{$mediaFileId}</span>
					{#if videoProgressMsg}
						<div class="text-cyan-800 text-[11px] text-center">{videoProgressMsg}</div>
					{/if}
				</div>
				<button
					type="button"
					id="media-menu-button"
					onclick={toggleMediaMenu}
					class="inline-flex self-center shrink-0 items-center justify-center rounded-md px-2 py-1 {$collabId ? 'bg-green-500 text-black' : 'bg-gray-800 text-gray-300'} hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
					aria-haspopup="true"
					aria-expanded={isMobileViewport ? isMobileMediaMenuOpen : false}
					aria-label="Open media menu"
				>
					<i class="fas fa-bars"></i>
				</button>

				{#if !isMobileViewport}
					<Dropdown class="w-64 text-sm clapshot-dropdown media-dropdown z-[130]" triggeredBy="#media-menu-button">
						<DropdownItem onclick={() => isEDLImportOpen = true}><i class="fas fa-file-import"></i> {$t('nav.importEdl')}</DropdownItem>
						<DropdownItem onclick={() => isExportOpen = true}><i class="fas fa-file-export"></i> {$t('nav.exportComments')}</DropdownItem>
					</Dropdown>
				{/if}
			</div>
			{/if}
		</div>

		<!-- Username & avatar-->
		<div class="shrink-0" style="visibility: {$curUsername ? 'visible': 'hidden'}">
			<span class="flex w-auto items-center gap-2">
				<h6 class="hidden sm:block flex-1 mx-2 sm:mx-4 text-gray-400 font-semibold max-w-40 truncate">{displayUsername($curUsername)}</h6>
				<button id="user-menu-button" class="flex-0 ring-4 ring-slate-800 text-sm rounded-full" aria-haspopup="true" aria-expanded="false">
					{#if $curUserPic || $curUsername}
					<div class="w-10 block"><Avatar username={$curUsername} /></div>
					{/if}
				</button>
			</span>

			{#if $userMenuItems != undefined && $userMenuItems.filter((item) => item.label !== 'My Videos').length > 0}
				<Dropdown class="w-56 text-sm clapshot-dropdown user-dropdown z-50" triggeredBy="#user-menu-button">
					<div class="px-3 py-2">
						<div class="clapshot-user-language-row flex items-center justify-between gap-3 rounded-lg bg-slate-700/60 py-2 px-4">
							<span class="text-gray-200">{$t('nav.language')}</span>
							<select class="min-w-24 rounded-md border border-slate-500 bg-slate-800 px-2 py-1 text-sm text-gray-100" value={$locale} onchange={onLocaleChange} aria-label={$t('nav.language')}>
								{#each localeOptions as loc}
									<option value={loc.id} selected={loc.id === $locale}>{loc.label}</option>
								{/each}
							</select>
						</div>
					</div>
					<DropdownDivider />
					{#each $userMenuItems.filter((item) => item.label !== 'My Videos') as item, index}
						{#if item.type === "logout-basic-auth"}
							<DropdownItem onclick={() => logoutBasicAuth()}>{$t('nav.logout')}</DropdownItem>
						{:else if item.type === "about"}
							<DropdownItem class="clapshot-user-about-item" onclick={showAbout}>{$t('nav.about')}</DropdownItem>
						{:else if item.type === "divider"}
							{#if index !== 0}
								<DropdownDivider />
							{/if}
						{:else if item.type === "url"}
							<DropdownItem href={item.data || "#"}>{item.label}</DropdownItem>
						{:else}
							<DropdownItem>UNKNOWN item.type '{item.type}'</DropdownItem>
						{/if}
					{/each}
				</Dropdown>
			{/if}
		</div>
	</div>
</nav>

{#if isMobileViewport && isMobileMediaMenuOpen}
	<div class="fixed inset-0 z-40 bg-black/50" role="button" tabindex="0" aria-label="Close media menu" onclick={closeMobileMediaMenu} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && closeMobileMediaMenu()}></div>
	<div class="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-gray-700 bg-gray-900 p-4 shadow-2xl">
		<div class="mb-3 flex items-center justify-between">
			<h3 class="text-base font-semibold text-gray-200">{$t('nav.experimentalTools')}</h3>
			<button type="button" class="rounded px-2 py-1 text-gray-300 hover:bg-gray-800" aria-label="Close media menu" onclick={closeMobileMediaMenu}><i class="fas fa-times"></i></button>
		</div>

		<div class="space-y-2 text-sm">
			<button type="button" class="flex w-full items-center justify-center rounded bg-gray-800 px-3 py-2 text-center text-gray-100" onclick={async () => { await copyToClipboard(); closeMobileMediaMenu(); }}><i class="fas fa-share-square mr-2"></i>{$t('nav.shareToLoggedInUsers')}</button>

			{#if $curVideo?.origUrl}
				<a class="flex w-full items-center justify-center rounded bg-gray-800 px-3 py-2 text-center text-gray-100" href={$curVideo?.origUrl} download onclick={closeMobileMediaMenu}><i class="fas fa-download mr-2"></i>{$t('nav.downloadOriginal')}</a>
			{/if}

			{#if $collabId}
				<a class="flex w-full items-center justify-center rounded bg-gray-800 px-3 py-2 text-center text-green-300" href="?vid={$mediaFileId}" onclick={closeMobileMediaMenu}><i class="fas fa-users mr-2"></i>{$t('nav.leaveCollab')}</a>
			{:else}
				<a class="flex w-full items-center justify-center rounded bg-gray-800 px-3 py-2 text-center text-gray-100" href="?vid={$mediaFileId}&collab={randomSessionId}" onclick={closeMobileMediaMenu}><i class="fas fa-user-plus mr-2"></i>{$t('nav.startCollab')}</a>
			{/if}

			<div class="my-2 border-t border-gray-700"></div>
			<button type="button" class="flex w-full items-center justify-center rounded bg-gray-800 px-3 py-2 text-center text-gray-100" onclick={() => { isEDLImportOpen = true; closeMobileMediaMenu(); }}><i class="fas fa-file-import mr-2"></i>{$t('nav.importEdl')}</button>
			<button type="button" class="flex w-full items-center justify-center rounded bg-gray-800 px-3 py-2 text-center text-gray-100" onclick={() => { isExportOpen = true; closeMobileMediaMenu(); }}><i class="fas fa-file-export mr-2"></i>{$t('nav.exportComments')}</button>
		</div>
	</div>
{/if}

<EDLImport bind:isOpen={isEDLImportOpen} onaddcomments={addEDLComments}/>
<ExportDialog bind:isOpen={isExportOpen}/>

<Modal title={$t('nav.logout')} dismissable={false} bind:open={loggedOut} class="w-96">
	<p><i class="fas fa fa-sign-in"></i> {$t('status.reloadToLogin')}</p>
</Modal>


<style>
@import url("https://fonts.googleapis.com/css2?family=Roboto+Condensed&family=Yanone+Kaffeesatz&display=swap");
</style>
