type RouterConfig = {
  routes: string[];
};

type Fetcher = {
  fetch: (request: Request) => Promise<Response> | Response;
};

type Env = {
  _config: RouterConfig;
} & {
  [key: string]: Fetcher;
};

export default {
  fetch(request: Request, env: Env) {
    const config = env._config;
    const [, route] = new URL(request.url).pathname.toLowerCase().split("/");

    if (!route || !config.routes.includes(route)) {
      return new Response(null, { status: 404 });
    }

    const worker = env[route];
    if (!worker || typeof worker.fetch !== "function") {
      return new Response(null, { status: 500 });
    }

    return worker.fetch(request);
  },
};
