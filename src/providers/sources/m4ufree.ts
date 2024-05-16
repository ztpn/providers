// kinda based on m4uscraper by Paradox_77
// thanks Paradox_77
import { load } from 'cheerio';

import { SourcererEmbed, makeSourcerer } from '@/providers/base';
import { compareMedia } from '@/utils/compare';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

let baseUrl = 'https://m4ufree.tv';

const universalScraper = async (ctx: MovieScrapeContext | ShowScrapeContext) => {
  // this redirects to ww1.m4ufree.tv or ww2.m4ufree.tv
  // if i explicitly keep the base ww1 while the load balancers thinks ww2 is optimal
  // it will keep redirecting all the requests
  // not only that but the last iframe request will fail
  const homePage = await ctx.proxiedFetcher.full(baseUrl);
  baseUrl = new URL(homePage.finalUrl).origin;

  const searchPage$ = load(
    await ctx.proxiedFetcher<string>(`/search/${ctx.media.title.toLowerCase().replaceAll(/[^a-z0-9A-Z]/g, '-')}.html`, {
      baseUrl,
      query: {
        type: ctx.media.type === 'movie' ? 'movie' : 'tvs',
      },
    }),
  );

  const searchResults: { title: string; year: number | undefined; url: string }[] = [];
  searchPage$('.item').each((_, element) => {
    const [, title, year] =
      searchPage$(element)
        // the title emement on their page is broken
        // it just breaks when the titles are too big
        .find('.imagecover a')
        .attr('title')
        // ex-titles: Home Alone 1990, Avengers Endgame (2019)
        ?.match(/^(.*?)\s*(?:\(?(\d{4})\)?)?\s*$/) || [];
    const url = searchPage$(element).find('a').attr('href');

    if (!title || !url) return;

    searchResults.push({ title, year: year ? parseInt(year, 10) : undefined, url });
  });

  const watchPageUrl = searchResults.find((x) => x && compareMedia(ctx.media, x.title, x.year))?.url;
  if (!watchPageUrl) throw new NotFoundError('No watchable item found');

  const watchPage = await ctx.proxiedFetcher.full(watchPageUrl, {
    baseUrl,
    readHeaders: ['Set-Cookie'],
  });

  let watchPage$ = load(watchPage.body);

  const csrfToken = watchPage$('script:contains("_token:")')
    .html()
    ?.match(/_token:\s?'(.*)'/m)?.[1];
  if (!csrfToken) throw new Error('Failed to find csrfToken');

  // I tried using parseSetCookie from utils/cookie
  // But it just parses the first cookie for some reason
  // even makeCookieHeader was messging up smth
  // plus doesn't really matter
  const cookie = watchPage.headers.get('Set-Cookie')?.match(/(laravel_session=.*?);/m)?.[1];
  if (!cookie) throw new Error('Failed to find cookie');

  if (ctx.media.type === 'show') {
    const s = ctx.media.season.number < 10 ? `0${ctx.media.season.number}` : ctx.media.season.number.toString();
    const e = ctx.media.episode.number < 10 ? `0${ctx.media.episode.number}` : ctx.media.episode.number.toString();

    const episodeToken = watchPage$(`button:contains("S${s}-E${e}")`).attr('idepisode');
    if (!episodeToken) throw new Error('Failed to find episodeToken');

    watchPage$ = load(
      await ctx.proxiedFetcher<string>('/ajaxtv', {
        baseUrl,
        method: 'POST',
        body: new URLSearchParams({
          idepisode: episodeToken,
          _token: csrfToken,
        }),
        headers: {
          cookie,
        },
      }),
    );
  }

  const embeds: SourcererEmbed[] = [];

  const sources: { name: string; data: string }[] = watchPage$('div.row.justify-content-md-center div.le-server')
    .map((_, element) => {
      const name = watchPage$(element).find('span').text().toLowerCase().replace('#', '');
      const data = watchPage$(element).find('span').attr('data');

      if (!data || !name) return null;
      return { name, data };
    })
    .get();

  for (const source of sources) {
    let embedId;
    if (source.name === 'm')
      embedId = 'playm4u-m'; // TODO
    else if (source.name === 'nm') embedId = 'playm4u-nm';
    else if (source.name === 'h') embedId = 'hydrax';
    else continue;

    const iframePage$ = load(
      await ctx.proxiedFetcher<string>('/ajax', {
        baseUrl,
        method: 'POST',
        body: new URLSearchParams({
          m4u: source.data,
          _token: csrfToken,
        }),
        headers: {
          cookie,
        },
      }),
    );

    const url = iframePage$('iframe').attr('src');
    if (!url) continue;

    embeds.push({ embedId, url });
  }

  return {
    embeds,
  };
};

export const m4uScraper = makeSourcerer({
  id: 'm4ufree',
  name: 'M4UFree',
  rank: 125,
  flags: [],
  scrapeMovie: universalScraper,
  scrapeShow: universalScraper,
});
