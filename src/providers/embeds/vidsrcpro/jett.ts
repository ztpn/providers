import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { Caption, getCaptionTypeFromUrl, labelToLanguageCode } from '@/providers/captions';
import { NotFoundError } from '@/utils/errors';

type embedRes = {
  source: string;
  thumbnails?: string;
  subtitles?: {
    file: string;
    label: string;
  }[];
};
type ThumbnailTrack = {
  type: 'vtt';
  url: string;
};

export const jettScraper = makeEmbed({
  id: 'jett',
  name: 'Jett',
  rank: 300,
  scrape: async (ctx) => {
    const embedRes = await ctx.proxiedFetcher<embedRes>(ctx.url, {
      headers: {
        referer: ctx.url,
      },
    });
    if (!embedRes.source) throw new NotFoundError('No watchable item found');

    const captions: Caption[] = [];
    if (embedRes.subtitles) {
      for (const caption of embedRes.subtitles) {
        const language = labelToLanguageCode(caption.label);
        const captionType = getCaptionTypeFromUrl(caption.file);
        if (!language || !captionType) continue;
        captions.push({
          id: caption.file,
          url: caption.file,
          type: captionType,
          language,
          hasCorsRestrictions: false,
        });
      }
    }

    let thumbnailTrack: ThumbnailTrack | undefined;
    if (embedRes.thumbnails) {
      thumbnailTrack = {
        type: 'vtt',
        url: embedRes.thumbnails,
      };
    }

    return {
      stream: [
        {
          id: 'primary',
          type: 'hls',
          playlist: embedRes.source,
          headers: {
            Referer: new URL(ctx.url).origin,
          },
          thumbnailTrack,
          captions,
          flags: [flags.IP_LOCKED],
        },
      ],
    };
  },
});
