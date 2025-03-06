<script lang="ts">
	import { faviconImageUri, getRoboHashURL, gitHubUrl, titleLogoImageUri } from '$lib/config';
	import {
		getAbsoluteTime,
		getEvent9734,
		getTargetEvent,
		getRelativeTime,
		type ProfileContentEvent
	} from '$lib/utils';
	import {
		fetchEventsMention,
		getEventsMention,
		getProfileName,
		getReadTimeOfNotification,
		sendReadTime
	} from '$lib/resource.svelte';
	import Reaction from '$lib/components/kinds/Reaction.svelte';
	import Content from '$lib/components/Content.svelte';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { NostrEvent } from 'nostr-tools/pure';
	import { isParameterizedReplaceableKind, isReplaceableKind } from 'nostr-tools/kinds';
	import * as nip19 from 'nostr-tools/nip19';
	import { unixNow } from 'applesauce-core/helpers';
	import { decode } from 'light-bolt11-decoder';
	import { _ } from 'svelte-i18n';

	let {
		loginPubkey,
		currentProfilePointer,
		query,
		urlSearchParams,
		profileMap,
		mutedPubkeys,
		mutedWords,
		mutedHashTags,
		isEnabledRelativeTime,
		nowRealtime,
		isEnabledScrollInfinitely = $bindable()
	}: {
		loginPubkey: string | undefined;
		currentProfilePointer: nip19.ProfilePointer | undefined;
		query: string | undefined;
		urlSearchParams: URLSearchParams;
		profileMap: Map<string, ProfileContentEvent>;
		mutedPubkeys: string[];
		mutedWords: string[];
		mutedHashTags: string[];
		isEnabledRelativeTime: boolean;
		nowRealtime: number;
		isEnabledScrollInfinitely: boolean;
	} = $props();

	const removeMutedEvent = (events: NostrEvent[]): NostrEvent[] => {
		return events.filter(
			(event) =>
				!mutedPubkeys.includes(event.pubkey) &&
				!mutedWords.some((word) => event.content.toLowerCase().includes(word)) &&
				!mutedHashTags.some((t) =>
					event.tags
						.filter((tag) => tag.length >= 2 && tag[0] === 't')
						.map((tag) => tag[1].toLowerCase())
						.includes(t)
				) &&
				!event.tags.some(
					(tag) => tag.length >= 2 && tag[0] === 'p' && mutedPubkeys.includes(tag[1])
				)
		);
	};

	const eventsMention: NostrEvent[] = $derived(getEventsMention());
	const readTimeOfNotification: number = $derived(getReadTimeOfNotification());
	const countUnread: number = $derived.by(() => {
		const created_at = eventsMention.at(-1)?.created_at;
		if (created_at === undefined) {
			return 0;
		}
		let r: number = 0;
		for (const ev of removeMutedEvent(eventsMention)) {
			if (readTimeOfNotification < ev.created_at) {
				r++;
			} else {
				break;
			}
		}
		return r;
	});

	let queryInput: string = $state('');
	let inputSearch: HTMLInputElement | undefined = $state();
	let searchType: string = $state('channel');
	const goSearchUrl = () => {
		if (inputSearch === undefined) {
			return;
		}
		if (inputSearch.validity.patternMismatch) {
			return;
		}
		let path: string;
		let kinds: number[];
		if (searchType === 'note') {
			path = `/search/${encodeURI(queryInput)}`;
			kinds = [1, 42];
		} else if (searchType === 'kind') {
			path = page.url.pathname;
			if (!/^(\/|\/antenna|\/npub1\w+)$/.test(path)) {
				path = '/';
			}
			kinds = queryInput
				.split(',')
				.filter((s) => /^\d+$/.test(s))
				.map((s) => parseInt(s));
		} else {
			path = `/search/${encodeURI(queryInput)}`;
			kinds = [40, 41];
		}
		const kvs: [string, string][] = kinds.map((k) => ['kind', String(k)]);
		if (currentProfilePointer !== undefined) {
			kvs.push(['author', currentProfilePointer.pubkey]);
		}
		goto(`${path}?${new URLSearchParams(kvs).toString()}`);
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
		const created_at = eventsMention.at(0)?.created_at ?? 0;
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
				const until: number = timelineSliced.at(-1)?.created_at ?? unixNow();
				const correctionCount: number = $state.snapshot(
					timelineSliced.filter((event) => event.created_at === until).length
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
			timelineSliced.filter((event) => event.created_at === timelineSliced.at(-1)?.created_at)
				.length
		);
		countToShow = 10 - correctionCount;
	});
	$effect(() => {
		if (query !== undefined) {
			queryInput = query;
		}
		if (urlSearchParams !== undefined) {
			let type = 'channel';
			if (!page.url.pathname.includes('/search/')) {
				//iPhone の Safari では URLSearchParamsIterator に every() は生えていないため for で回すしかない
				for (const [k, v] of urlSearchParams.entries()) {
					if (k === 'kind' && /^\d+$/.test(v)) {
						type = 'kind';
						break;
					}
				}
			} else {
				for (const [k, v] of urlSearchParams.entries()) {
					if (!(k === 'kind' && /^\d+$/.test(v) && [40, 41].includes(parseInt(v)))) {
						type = 'note';
						break;
					}
				}
			}
			searchType = type;
		}
	});

	const timelineSliced = $derived(eventsMention.slice(0, countToShow));
	const mentionToShow = $derived(removeMutedEvent(timelineSliced));
</script>

<header class="GlobalHeader">
	<div class="GlobalHeader__body">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<span
			class="GlobalHeader__Item GlobalHeader__menuToggle"
			onclick={() => {
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
			<span class="GlobalHeader__brand router-link-exact-active router-link-active">
				<a
					aria-label="GitHub"
					href={gitHubUrl}
					target="_blank"
					rel="noopener noreferrer"
					title="GitHub"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
						<path
							fill-rule="evenodd"
							d="M10.0172337,20.0036431 C10.022429,20.1264837 10.0091724,20.2463579 9.98330461,20.3676906 C9.93784953,20.5808973 9.85006902,20.806507 9.72581375,21.0149561 C9.37258963,21.6075205 8.77254382,22.0029294 8,22.0029294 C6.18009841,22.0029294 5.46583567,21.110101 4.57152331,18.8743201 C3.96583567,17.360101 3.68009841,17.0029294 3,17.0029294 L3,15.0029294 C4.81990159,15.0029294 5.53416433,15.8957579 6.42847669,18.1315388 C7.03416433,19.6457579 7.31990159,20.0029294 8,20.0029294 C8,19.7127644 7.99602627,19.4557363 7.98766336,19.10766 C7.96806324,18.2918745 7.96580921,18.1253294 8.00139994,17.9072328 C8.01562221,17.4311461 8.13853505,17.0933379 8.38499657,16.758055 C6.15319163,16.2722225 4.64792011,15.2688507 3.78397367,13.6414131 L3.46033692,12.8803116 C3.14504523,11.9742045 3,10.9475314 3,9.76182789 C3,8.3962705 3.41634612,7.17529446 4.19401809,6.15466942 C3.95142672,5.18452501 3.98465035,3.99922139 4.52030872,2.66060213 L4.69533986,2.22319636 L5.14406803,2.07965982 C5.20414701,2.06044211 5.27718427,2.04308516 5.36298939,2.02961795 C6.2367624,1.89247825 7.48010477,2.21967938 9.10554673,3.26084348 C10.0637668,3.03871956 11.0728464,2.92657377 12.0887705,2.92657377 C12.9966325,2.92657377 13.8994565,3.01809831 14.761632,3.19853941 C16.3430593,2.20820612 17.552239,1.89759865 18.4025017,2.02979376 C18.4873192,2.04298081 18.5596096,2.06000541 18.6191923,2.07890005 L19.0707147,2.22208531 L19.2459583,2.66215824 C19.7145535,3.83889806 19.7949778,4.92336373 19.6244695,5.87228979 C20.5184674,6.94500389 21,8.26378067 21,9.76182789 C21,11.0247658 20.9095208,11.9744236 20.64943,12.8982988 L20.374903,13.6516598 C19.6562828,15.2773712 18.071463,16.2919934 15.627532,16.7752488 C15.881555,17.1269685 16,17.4840164 16,18.0029294 L16,19.0029294 C16,19.4875328 16,19.5024553 15.9988971,20.0029332 C16.0011677,20.0388683 16.0041674,20.0564681 16.0074409,20.0674343 C16.0069051,20.0676207 16.0044248,20.7127858 16,22.0029294 C15.1482062,22.0029294 14.5148687,21.5875264 14.2033753,20.9322561 C14.0418761,20.5925196 13.9936266,20.2681196 14,19.9887282 L14,18.0029294 C14,17.9190828 13.9970903,17.9142333 13.7928932,17.7100362 C13.2470903,17.1642333 13,16.7524162 13,16.0029294 L13,15.098327 L13.9000749,15.0079345 C16.5793439,14.7388614 18.0365375,13.994809 18.5196779,12.9078386 L18.7454621,12.2906007 C18.925117,11.6452201 19,10.8592573 19,9.76182789 C19,8.5957377 18.5929046,7.6324677 17.8229924,6.86285829 L17.399809,6.43984136 L17.5725269,5.86695742 C17.7259675,5.35801396 17.7624331,4.7557886 17.6001079,4.06889646 C17.5731265,4.07573155 17.5450908,4.08318009 17.5159887,4.09128216 C16.9805442,4.24035094 16.3120315,4.56021479 15.5064471,5.09869159 L15.139019,5.34429154 L14.7100567,5.23792413 C13.880388,5.0321958 12.9888516,4.92657377 12.0887705,4.92657377 C11.0878626,4.92657377 10.0984637,5.05392119 9.18445917,5.30309711 L8.73840507,5.42470039 L8.3568182,5.1636581 C7.52362575,4.59367395 6.83145179,4.25470831 6.27642408,4.09636524 C6.23678449,4.08505652 6.19904057,4.07494077 6.16316427,4.06592263 C5.9695217,4.8609066 6.04611126,5.51405583 6.24223012,6.00416015 L6.47738305,6.59181128 L6.04688499,7.05581793 C5.36089731,7.79520071 5,8.69496705 5,9.76182789 C5,10.7385874 5.11434439,11.5479509 5.32388252,12.1576254 L5.58556699,12.7770588 C6.23973869,14.0045823 7.62920432,14.743076 10.1065792,15.0086252 L11,15.1043908 L11,16.0029294 C11,16.7524162 10.7529097,17.1642333 10.2071068,17.7100362 C10.0029097,17.9142333 10,17.9190828 10,18.0029294 L9.98276345,18.1877969 C9.97135799,18.2484289 9.97135799,18.404984 9.98708636,19.0596217 C9.99432024,19.3607065 9.99844271,19.5990116 9.99963477,19.8480351 C10.0115828,19.8995855 10.013389,19.9328439 10.0172337,20.0036431 Z"
						/>
					</svg>
				</a>
				<a href="/">
					<img alt="" src={titleLogoImageUri} />
				</a>
			</span>
		</div>
		<nav class="Nav" style="display: none;" bind:this={nav}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class="NavGroup Navgroup--search"
				onclick={() => {
					if (queryInput.length > 0) {
						goSearchUrl();
					}
				}}
			>
				<input
					type="search"
					placeholder={searchType === 'kind' ? '1,7,42,9735,...' : $_('Header.search')}
					pattern={searchType === 'kind' ? '[,\\d]+' : '.+'}
					class="Input"
					bind:value={queryInput}
					bind:this={inputSearch}
					onclick={(event) => {
						event.stopPropagation();
					}}
					onkeydown={(event) => {
						if (event.key === 'Enter' && queryInput.length > 0) {
							goSearchUrl();
						}
					}}
				/>
			</div>
			<ul class="NavGroup search-type">
				<li class="NavGroup__item">
					<input
						type="radio"
						id="search-channel"
						name="search-type"
						value="channel"
						bind:group={searchType}
					/>
					<label for="search-channel">{$_('Header.keyword')}</label>
				</li>
				<li class="NavGroup__item">
					<input
						type="radio"
						id="search-note"
						name="search-type"
						value="note"
						bind:group={searchType}
					/>
					<label for="search-note">{$_('Header.post')}</label>
				</li>
				<li class="NavGroup__item">
					<input
						type="radio"
						id="search-kind"
						name="search-type"
						value="kind"
						bind:group={searchType}
					/>
					<label for="search-kind">kind</label>
				</li>
			</ul>
			<ul class="NavGroup">
				{#if loginPubkey !== undefined}
					{@const prof = profileMap.get(loginPubkey)}
					<li class="NavGroup__item">
						<a href="/{nip19.npubEncode(loginPubkey)}" class="">
							<img
								src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(loginPubkey))}
								class="Avatar"
								alt=""
							/>{$_('Header.my-page')}</a
						>
					</li>
					<li class="NavGroup__item">
						<a href="/antenna" class="">
							<i class="fa-fw fas fa-broadcast-tower"></i> {$_('Header.antenna')}</a
						>
					</li>
				{/if}
				<li class="NavGroup__item">
					<a href="/" class="router-link-exact-active router-link-active" aria-current="page">
						<i class="fa-fw fas fa-sparkles"></i> {$_('Header.recent')}</a
					>
				</li>
				{#if loginPubkey !== undefined}
					<li class="NavGroup__item">
						<a href="/settings" class=""><i class="fa-fw fas fa-cog"></i> {$_('Header.settings')}</a
						>
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
						{$_('Header.notifications')}{#if countUnread > 0}{`(${countUnread})`}{/if}</span
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
					{#each mentionToShow as ev (ev.id)}
						{@const evTo = getTargetEvent(ev)}
						{@const ev9734 = getEvent9734(ev)}
						{@const evFrom = ev9734 ?? ev}
						{@const prof = profileMap.get(evFrom.pubkey)}
						<li
							data-type="star"
							data-unread={readTimeOfNotification < ev.created_at ? 'true' : 'false'}
							class="NoticeItem"
						>
							<div class="NoticeItem__icon">
								<img
									alt=""
									loading="lazy"
									src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(evFrom.pubkey))}
									title={getProfileName(evFrom.pubkey)}
									class="Avatar Avatar--md"
								/>
							</div>
							<div class="NoticeItem__body">
								<p>
									<a href="/{nip19.npubEncode(evFrom.pubkey)}" class="">
										<Content
											content={getProfileName(evFrom.pubkey)}
											tags={prof?.event.tags ?? []}
											isAbout={true}
										/>
									</a>
									{#if ev.kind === 7}
										added a <a href="/entry/{nip19.neventEncode({ ...ev, author: ev.pubkey })}"
											><Reaction reactionEvent={ev} profile={undefined} isAuthor={false} /></a
										>
									{:else if ev.kind === 8}
										<a href="/entry/{nip19.neventEncode({ ...ev, author: ev.pubkey })}">📛awarded</a
										>
									{:else if [1, 42, 1111].includes(ev.kind)}
										<a href="/entry/{nip19.neventEncode({ ...ev, author: ev.pubkey })}"
											>💬mentioned</a
										>
									{:else if [6, 16].includes(ev.kind)}
										<a href="/entry/{nip19.neventEncode({ ...ev, author: ev.pubkey })}"
											>🔁reposted</a
										>
									{:else if ev.kind === 9735}
										{@const invoice = decode(
											ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'bolt11')?.at(1) ?? ''
										)}
										{@const sats =
											parseInt(
												invoice.sections.find((section) => section.name === 'amount')?.value ?? '-1'
											) / 1000}
										<a href="/entry/{nip19.neventEncode({ ...ev, author: ev.pubkey })}"
											>⚡{#if sats > 0}{sats}{/if} zapped</a
										>
									{/if}
									{#if ev.kind !== 8}
										to
									{/if}
									<br />
									{#if evTo !== undefined}
										{@const d =
											evTo.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}
										{@const link =
											isReplaceableKind(evTo.kind) || isParameterizedReplaceableKind(evTo.kind)
												? `/entry/${nip19.naddrEncode({ identifier: d, pubkey: evTo.pubkey, kind: evTo.kind })}`
												: `/entry/${nip19.neventEncode({ ...evTo, author: evTo.pubkey })}`}
										<a href={link}>
											{#if ev.kind === 8 && evTo.kind === 30009}
												{@const image =
													evTo.tags.find((tag) => tag.length >= 2 && tag[0] === 'image')?.at(1) ??
													''}
												{@const title =
													evTo.tags.find((tag) => tag.length >= 2 && tag[0] === 'name')?.at(1) ??
													''}
												{#if URL.canParse(image)}
													<img alt={title} {title} class="badge" src={image} />
												{/if}
											{:else}
												<Content
													content={evTo.content.length > 20
														? `${evTo.content.slice(0, 20)}...`
														: evTo.content}
													tags={evTo.tags}
													enableAutoLink={false}
												/>
											{/if}
										</a>
									{/if}
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
										>{isEnabledRelativeTime
											? getRelativeTime(nowRealtime, ev.created_at)
											: getAbsoluteTime(ev.created_at)}</time
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
	}
	.GlobalHeader__body span.scroll > button:disabled {
		cursor: not-allowed;
	}
	.GlobalHeader__brand svg {
		width: 28px;
		height: 28px;
		fill: var(--text-color);
		vertical-align: middle;
	}
	.GlobalHeader__body span.scroll > button > svg {
		width: 16px;
		height: 16px;
		fill: var(--text-color);
	}
	.GlobalHeader__body span.scroll > button:active > svg {
		fill: yellow;
	}
	.badge {
		width: 32px;
		height: 32px;
	}
	.search-type {
		margin-right: auto;
	}
	input:invalid {
		border: red solid 1px;
	}
</style>
