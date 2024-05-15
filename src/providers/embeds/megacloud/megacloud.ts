import { makeEmbed } from '@/providers/base';

import { megaCloudScraper } from './upcloud';

// both megacloud and megacdn are pretty much the same thing but return different streams
export const megaCdnScraper = makeEmbed({
  id: 'megacdn',
  name: 'MegaCdn',
  rank: 304,
  async scrape(ctx) {
    const result = await megaCloudScraper.scrape(ctx);
    return {
      stream: result.stream.map((x) => ({
        ...x,
        flags: [],
      })),
    };
  },
});
