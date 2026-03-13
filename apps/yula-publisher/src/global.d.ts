import type _fetch from "node-fetch";

declare global {
    export const fetch: typeof _fetch;
    export const {
        Headers,
        Request,
        Response,
    }: typeof import("node-fetch");

    interface EnvVariableTypes {
        DATA_PATH: string;
    }
}
