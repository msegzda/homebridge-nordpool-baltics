export default {
    async fetch(request, env) {
        return new Response(null, { status: 405 });
    },

    // Handles Cron triggers (the scheduled agent runs)
    async scheduled(event, env, ctx) {
        await this.elering(env);
    },

    async elering(env) {
        const start = new Date();
        start.setUTCDate(start.getUTCDate() - 1);
        start.setUTCHours(20, 0, 0, 0);

        const end = new Date();
        end.setUTCDate(end.getUTCDate() + 2);
        end.setUTCHours(2, 0, 0, 0);

        const url = `https://dashboard.elering.ee/api/nps/price?start=${start.toISOString()}&end=${end.toISOString()}`;
        console.log(`GET ${url}`);

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data && data.success && data.data) {
                // iterate through ee, lt, lv, fi and save into individual files on bucket
                for (const region of ['ee', 'lt', 'lv', 'fi']) {
                    const regionData = data.data[region];
                    if (regionData) {
                        await env.BUCKET.put(`elering_${region.toUpperCase()}.json`, JSON.stringify(regionData), {
                            httpMetadata: {
                                contentType: 'application/json',
                            },
                        });
                        console.log(`Successfully updated R2 elering_${region.toUpperCase()}.json`);
                    } else {
                        console.log(`WARN: No data for region ${region.toUpperCase()}`);
                    }
                }
            } else {
                console.log(`ERR: Unexpected response from Elering API: ${JSON.stringify(data)}`);
                console.log(`ERR: Full response: ${response.status} ${response.statusText}`);
            }
        } catch (err) {
            console.log(`ERR: Agent fetch error: ${err.message}`);
        }
    },
};

// to manually deploy run this
// npm run deploy --prefix nordpool-cf
