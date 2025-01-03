<script lang="ts">
	import { faviconImageUri, getRoboHashURL, titleLogoImageUri } from '$lib/config';
	import { getRelativetime, type ProfileContentEvent } from '$lib/utils';
	import {
		fetchEventsMention,
		getEventsMention,
		getProfileName,
		getReadTimeOfNotification,
		sendReadTime
	} from '$lib/resource.svelte';
	import Reaction from '$lib/components/Reaction.svelte';
	import Content from '$lib/components/Content.svelte';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import type { NostrEvent } from 'nostr-tools/pure';
	import * as nip19 from 'nostr-tools/nip19';
	import { unixNow } from 'applesauce-core/helpers';

	let {
		loginPubkey,
		profileMap,
		mutedPubkeys,
		nowRealtime,
		isEnabledScrollInfinitely = $bindable()
	}: {
		loginPubkey: string | undefined;
		profileMap: Map<string, ProfileContentEvent>;
		mutedPubkeys: string[];
		nowRealtime: number;
		isEnabledScrollInfinitely: boolean;
	} = $props();

	const eventsMention: { baseEvent: NostrEvent; targetEvent: NostrEvent | undefined }[] =
		$derived(getEventsMention());
	const readTimeOfNotification: number = $derived(getReadTimeOfNotification());
	const countUnread: number = $derived.by(() => {
		const created_at = eventsMention.at(-1)?.baseEvent?.created_at;
		if (created_at === undefined) {
			return 0;
		}
		let r: number = 0;
		for (const ev of eventsMention) {
			if (readTimeOfNotification < ev.baseEvent.created_at) {
				r++;
			} else {
				break;
			}
		}
		return r;
	});
	let query: string = $state('');

	const goSearchUrl = () => {
		goto(`/search/${query}`);
	};

	let nav: HTMLElement;
	let showNotice: boolean = $state(false);
	let isClickedNoticeIcon: boolean = false;
	let countToShow: number = $state(10);
	let isScrolledBottom = false;
	let isLoading = false;
	const scrollThreshold = 400;
	let noticeListBody: HTMLElement;

	const handlerNoticeList = (ev: MouseEvent): void => {
		const target: HTMLElement | null = ev.target as HTMLElement | null;
		if (!target?.closest('.NoticeList')) {
			if (isClickedNoticeIcon) {
				isClickedNoticeIcon = false;
				return;
			}
			if (showNotice) {
				showNotice = false;
				updateReadTime();
			}
		}
	};

	const updateReadTime = () => {
		const created_at = eventsMention.at(0)?.baseEvent.created_at ?? 0;
		if (readTimeOfNotification < created_at) {
			sendReadTime(created_at);
		}
	};

	const handlerNoticeListBody = () => {
		const scrollHeight = Math.max(
			noticeListBody.scrollHeight,
			noticeListBody.offsetHeight,
			noticeListBody.clientHeight
		);
		const pageMostBottom = scrollHeight;
		const scrollTop = noticeListBody.scrollTop;
		if (scrollTop > pageMostBottom - scrollThreshold) {
			if (!isScrolledBottom && !isLoading) {
				console.log('[Loading Start]');
				isScrolledBottom = true;
				isLoading = true;
				const until: number = timelineSliced.at(-1)?.baseEvent.created_at ?? unixNow();
				const correctionCount: number = $state.snapshot(
					timelineSliced.filter(({ baseEvent }) => baseEvent.created_at === until).length
				);
				fetchEventsMention(until, () => {
					console.log('[Loading Complete]');
					countToShow += 10 - correctionCount; //unitlと同時刻のイベントは被って取得されるので補正
					isLoading = false;
				});
			}
		} else if (isScrolledBottom && scrollTop < pageMostBottom + scrollThreshold) {
			isScrolledBottom = false;
		}
	};
	beforeNavigate(() => {
		noticeListBody.removeEventListener('scroll', handlerNoticeListBody);
		document.removeEventListener('click', handlerNoticeList);
		countToShow = 10;
	});
	afterNavigate(() => {
		noticeListBody.addEventListener('scroll', handlerNoticeListBody);
		document.addEventListener('click', handlerNoticeList);
		const correctionCount: number = $state.snapshot(
			timelineSliced.filter(
				({ baseEvent }) => baseEvent.created_at === timelineSliced.at(-1)?.baseEvent.created_at
			).length
		);
		countToShow = 10 - correctionCount;
	});

	const timelineAll: {
		baseEvent: NostrEvent;
		targetEvent: NostrEvent | undefined;
	}[] = $derived(
		eventsMention.filter(
			(evs) =>
				!evs.baseEvent.tags.some(
					(tag) => tag.length >= 2 && tag[0] === 'p' && mutedPubkeys.includes(tag[1])
				)
		)
	);
	const timelineSliced = $derived(timelineAll.slice(0, countToShow));
	const mentionToShow = $derived(
		timelineSliced.filter(({ baseEvent }) => !mutedPubkeys.includes(baseEvent.pubkey))
	);
</script>

<header class="GlobalHeader">
	<div class="GlobalHeader__body">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<span
			class="GlobalHeader__Item GlobalHeader__menuToggle"
			onclick={(_event) => {
				if (nav.style.display) {
					nav.style.display = '';
				} else {
					nav.style.display = 'none';
				}
			}}
		>
			<i class="fas fa-fw fa-bars"></i>
		</span>
		<div class="GlobalHeader__Item">
			<a href="/" class="GlobalHeader__brand router-link-exact-active router-link-active">
				<img alt="" src={titleLogoImageUri} />
			</a>
		</div>
		<nav class="Nav" style="display: none;" bind:this={nav}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class="NavGroup Navgroup--search"
				onclick={() => {
					if (query.length > 0) {
						goSearchUrl();
					}
				}}
			>
				<input
					type="search"
					placeholder="検索"
					class="Input"
					bind:value={query}
					onclick={(event) => {
						event.stopPropagation();
					}}
					onkeydown={(event) => {
						if (event.key === 'Enter' && query.length > 0) {
							goSearchUrl();
						}
					}}
				/>
			</div>
			<ul class="NavGroup">
				{#if loginPubkey !== undefined}
					{@const prof = profileMap.get(loginPubkey)}
					<li class="NavGroup__item">
						<a href="/{nip19.npubEncode(loginPubkey)}" class="">
							<img
								src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(loginPubkey))}
								class="Avatar"
								alt=""
							/>マイページ</a
						>
					</li>
					<li class="NavGroup__item">
						<a href="/antenna" class=""> <i class="fa-fw fas fa-broadcast-tower"></i> アンテナ</a>
					</li>
				{/if}
				<li class="NavGroup__item">
					<a href="/" class="router-link-exact-active router-link-active" aria-current="page">
						<i class="fa-fw fas fa-sparkles"></i> 最新の投稿</a
					>
				</li>
				{#if loginPubkey !== undefined}
					<li class="NavGroup__item">
						<a href="/settings" class=""><i class="fa-fw fas fa-cog"></i> 設定</a>
					</li>
				{/if}
			</ul>
		</nav>
		<div class="GlobalHeader__notices">
			<span class="scroll">
				<button
					aria-label="Scroll Button"
					class="scroll"
					title="scroll"
					onclick={() => {
						isEnabledScrollInfinitely = false;
						window.scroll({
							top: document.documentElement.scrollHeight - document.documentElement.clientHeight,
							behavior: 'smooth'
						});
					}}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
						<path
							fill-rule="evenodd"
							d="M12,23 C5.92486775,23 1,18.0751322 1,12 C1,5.92486775 5.92486775,1 12,1 C18.0751322,1 23,5.92486775 23,12 C23,18.0751322 18.0751322,23 12,23 Z M12,21 C16.9705627,21 21,16.9705627 21,12 C21,7.02943725 16.9705627,3 12,3 C7.02943725,3 3,7.02943725 3,12 C3,16.9705627 7.02943725,21 12,21 Z M15.2928932,11.2928932 L16.7071068,12.7071068 L12,17.4142136 L7.29289322,12.7071068 L8.70710678,11.2928932 L12,14.5857864 L15.2928932,11.2928932 Z M12,10.5857864 L15.2928932,7.29289322 L16.7071068,8.70710678 L12,13.4142136 L7.29289322,8.70710678 L8.70710678,7.29289322 L12,10.5857864 Z"
						/>
					</svg>
				</button>
			</span>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				onclick={() => {
					isClickedNoticeIcon = true;
					showNotice = !showNotice;
					if (!showNotice) {
						updateReadTime();
					}
				}}
			>
				<i class="fa-fw far fa-bell"></i>
				{#if loginPubkey !== undefined}
					<span class="NoticeBadge" style={countUnread > 0 ? '' : 'display: none;'}
						>{countUnread || ''}</span
					>
				{/if}
			</span>
			<div class={showNotice ? 'NoticeList' : 'NoticeList hide'}>
				<div class="NoticeList__head">
					<span class="NoticeList__title">
						通知{#if countUnread > 0}{`(${countUnread})`}{/if}</span
					>
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<i
						class="NoticeList__closeIcon far fa-times"
						onclick={() => {
							isClickedNoticeIcon = true;
							showNotice = false;
							updateReadTime();
						}}
					></i>
				</div>
				<ul class="NoticeList__body" bind:this={noticeListBody}>
					{#each mentionToShow as obj (obj.baseEvent.id)}
						{@const ev = obj.baseEvent}
						{@const evTo = obj.targetEvent}
						{@const prof = profileMap.get(ev.pubkey)}
						<li
							data-type="star"
							data-unread={readTimeOfNotification < ev.created_at ? 'true' : 'false'}
							class="NoticeItem"
						>
							<div class="NoticeItem__icon">
								<img
									alt=""
									loading="lazy"
									src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(ev.pubkey))}
									title={getProfileName(prof)}
									class="Avatar Avatar--md"
								/>
							</div>
							<div class="NoticeItem__body">
								<p>
									<a href="/{nip19.npubEncode(ev.pubkey)}" class="">
										<Content
											content={getProfileName(prof)}
											tags={prof?.event.tags ?? []}
											isAbout={true}
										/>
									</a>
									さんが
									<br />
									{#if evTo !== undefined}
										<a href="/entry/{nip19.neventEncode({ ...evTo, author: evTo.pubkey })}">
											<Content
												content={evTo.content.length > 20
													? `${evTo.content.slice(0, 20)}...`
													: evTo.content}
												tags={evTo.tags}
												enableAutoLink={false}
											/>
										</a>
										{[6, 16].includes(ev.kind) ? 'を' : 'に'}
									{/if}
									<br />
									{#if ev.kind === 7}
										<Reaction reactionEvent={ev} profile={undefined} isAuthor={false} />
									{:else if [1, 42].includes(ev.kind)}
										<a href="/entry/{nip19.neventEncode({ ...ev, author: ev.pubkey })}">コメント</a>
									{:else if [6, 16].includes(ev.kind)}
										<a href="/entry/{nip19.neventEncode({ ...ev, author: ev.pubkey })}">リポスト</a>
									{:else if ev.kind === 9734}
										Zap
									{/if}
									しました
								</p>
								<span class="NoticeItem__foot"
									>{#if evTo !== undefined}<a
											href="/entry/{nip19.neventEncode({ ...evTo, author: evTo.pubkey })}"
											><img alt="" loading="lazy" src={faviconImageUri} /></a
										>{/if}
									<time
										datetime={new Date(1000 * ev.created_at).toISOString()}
										title={new Date(1000 * ev.created_at).toLocaleString()}
										class="NoticeItem__time"
										>{getRelativetime(nowRealtime, 1000 * ev.created_at)}</time
									></span
								>
							</div>
						</li>
					{/each}
				</ul>
			</div>
		</div>
	</div>
</header>

<style>
	.hide {
		display: none;
	}
	.GlobalHeader__body span.scroll {
		font-size: 12px;
	}
	.GlobalHeader__body span.scroll > button {
		border: none;
		outline: none;
		padding: 0;
		height: 16px;
		cursor: pointer;
		margin: 0;
		background-color: rgba(127, 127, 127, 0);
		border-radius: 10%;
		vertical-align: bottom;
	}
	.GlobalHeader__body span.scroll > button:disabled {
		cursor: not-allowed;
	}
	.GlobalHeader__body span.scroll > button > svg {
		width: 16px;
		height: 16px;
		fill: var(--text-color);
	}
	.GlobalHeader__body span.scroll > button:active > svg {
		fill: yellow;
	}
</style>
