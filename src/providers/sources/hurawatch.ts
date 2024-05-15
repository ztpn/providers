import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { compareMedia } from '@/utils/compare';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

const baseUrl = 'https://hurawatchz.to';

async function getEpisodeId(showId: string, ctx: ShowScrapeContext) {
  const seasonPage$ = load(
    await ctx.proxiedFetcher<string>(`/ajax/season/list/${showId}`, {
      baseUrl,
    }),
  );

  const seasons = seasonPage$('.dropdown-menu a')
    .toArray()
    .map((el) => {
      const id = seasonPage$(el).attr('data-id');
      const seasonNumber = seasonPage$(el).html()?.split(' ')[1];

      if (!id || !seasonNumber || Number.isNaN(Number(seasonNumber))) throw new Error('invalid season');

      return {
        id,
        season: Number(seasonNumber),
      };
    });
  const seasonId = seasons.find((season) => season.season === ctx.media.season.number)?.id;

  if (!seasonId) throw new NotFoundError('Season not found');

  const episodePage$ = load(
    await ctx.proxiedFetcher<string>(`/ajax/season/episodes/${seasonId}`, {
      baseUrl,
    }),
  );

  const episodes = episodePage$('.eps-item')
    .toArray()
    .map((el) => {
      const id = episodePage$(el).attr('data-id');
      const title = episodePage$(el).attr('title');

      if (!id || !title) throw new Error('invalid episode');

      const match = title.match(/Eps (\d*):/);
      if (!match || Number.isNaN(Number(match[1]))) throw new Error('invalid episode');

      return {
        id,
        episode: Number(match[1]),
      };
    });

  const episodeId = episodes.find((episode) => episode.episode === ctx.media.episode.number)?.id;
  if (!episodeId) throw new NotFoundError('Episode not found');
  return episodeId;
}

async function universalScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  const searchPage$ = load(
    await ctx.proxiedFetcher<string>(`/search/${ctx.media.title.replaceAll(/[^a-z0-9A-Z]/g, '-')}`, {
      baseUrl,
    }),
  );

  const search = searchPage$('div.film-detail')
    .toArray()
    .map((movieEl) => ({
      title: searchPage$(movieEl).find('h2.film-name a').text()?.trim() || '',

      year: Number(searchPage$(movieEl).find('span.fdi-item:first').text()?.trim()) || undefined,

      type: (searchPage$(movieEl).find('span.fdi-type').text() === 'TV' ? 'show' : 'movie') as 'show' | 'movie',

      href: searchPage$(movieEl).find('h2.film-name a').attr('href') ?? '',
    }))
    .filter((movie) => movie.title && movie.href);

  let id;
  if (ctx.media.type === 'movie')
    id = search
      .find((x) => x && compareMedia(ctx.media, x.title, x.year) && (!x.type || x.type === ctx.media.type))
      ?.href.split('-')
      .pop()
      ?.trim();

  // shows dont have the year on the search page,
  // so we need to get the year from the details
  if (ctx.media.type === 'show') {
    const filtered = search.filter(
      // incase the type is missing, it'll filter the ones without the year
      (x) => x && ((!x.type && !x.year) || x.type === ctx.media.type) && compareMedia(ctx.media, x.title),
    );

    for (const result of filtered) {
      const detailsPage = await ctx.proxiedFetcher<string>(result.href, {
        baseUrl,
      });

      const match = detailsPage.match(/Released:<\/span> (\d.*)-\d.*-\d.*/);

      if (match) {
        const year = Number(match[1]);
        if (!Number.isNaN(year) && compareMedia(ctx.media, result.title, year)) {
          const showId = result.href.split('-').pop()?.trim();
          if (showId) id = await getEpisodeId(showId, ctx as ShowScrapeContext);
        }
      }
    }
  }

  if (!id) throw new NotFoundError('No watchable item found');

  const endpoint = ctx.media.type === 'movie' ? 'list' : 'servers';
  const sourcesPage$ = load(
    await ctx.proxiedFetcher<string>(`/ajax/episode/${endpoint}/${id}`, {
      baseUrl,
    }),
  );

  const sources = sourcesPage$('.nav-item a')
    .toArray()
    .map((el) => {
      const embed = sourcesPage$(el).attr('title')?.replace('Server ', '').toLowerCase(); // Server UpCloud -> upcloud
      const sourceId = sourcesPage$(el).attr(ctx.media.type === 'movie' ? 'data-linkid' : 'data-id');

      if (!embed || !sourceId) throw new Error('invalid sources');

      return {
        embed,
        id: sourceId,
      };
    });

  const embeds: SourcererEmbed[] = [];
  for (const source of sources) {
    // upstream and mixdrop embeds are broken
    // they deleted all the movies and shows
    // upcloud and megacloud are the same thing here

    let embedId;
    switch (source.embed) {
      case 'upcloud':
        embedId = 'megacloud';
        break;
      case 'megacloud':
        embedId = 'megacdn';
        break;
      default:
        embedId = undefined;
    }

    if (embedId) {
      const sourceDetails = await ctx.proxiedFetcher<{ type: 'iframe'; link: string }>(
        `/ajax/episode/sources/${source.id}`,
        {
          baseUrl,
        },
      );
      if (sourceDetails.link) embeds.push({ embedId, url: sourceDetails.link });
    }
  }

  return {
    embeds,
  };
}

export const hurawatchScraper = makeSourcerer({
  id: 'hurawatch',
  name: 'HuraWatch',
  rank: 128,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: universalScraper,
  scrapeShow: universalScraper,
});
