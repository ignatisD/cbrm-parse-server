import { Application } from "express";
import * as Parse from "parse/node";
import { ParseServer } from "parse-server";
import * as ParseDashboard from "parse-dashboard";
import { IParseConnectionOptions } from "./ParseConnectionOptions";
import { IConnector } from "@ignatisd/cbrm";

export class ParseServerConnector implements IConnector {

    protected _uri: string = "mongodb://localhost:27017/test";
    protected _options: IParseConnectionOptions = {
        appId: "Test",
        masterKey: "test-master-key",
        fileKey: "",
        serverURL: "",
        maxUploadSize: "5mb",

        appName: "Test",
        appUser: "admin",
        appPass: "",
        appPath: "/api/parse",
        dashboardPath: "/api/dashboard",
        dashboardPrimary: "#000000",
        dashboardSecondary: "#3B3B3B",
        allowInsecureHTTP: true,
    };

    protected _api: any;
    protected _dashboard: any;

    constructor() {}

    public init(opts: { uri: string; options: IParseConnectionOptions }) {
        this._uri = opts.uri;
        if (opts.options) {
            this._options = {...this._options, ...opts.options};
        }
        this._api = new ParseServer({
            databaseURI: this._uri,
            ...this._options
        });
        // Start Parse Dashboard
        this._dashboard = new ParseDashboard({
            apps: [
                {
                    serverURL: this._options.serverURL,
                    appId: this._options.appId,
                    appName: this._options.appName,
                    appNameForURL: this._options.appName?.toLowerCase(),
                    masterKey: this._options.appName,
                    primaryBackgroundColor: this._options.dashboardPrimary,
                    secondaryBackgroundColor: this._options.dashboardSecondary
                }
            ],
            users: [
                {
                    user: this._options.appUser,
                    pass: this._options.appPass
                }
            ]
        }, {
            allowInsecureHTTP: this._options.allowInsecureHTTP
        });
        // Start Parse (will be available globally)
        Parse.initialize(this._options.appId, this._options.masterKey);
        return Promise.resolve(true);
    }

    public onAppReady(app?: Application) {
        if (app && this._options.appPath) {
            app.use(this._options.appPath, this._api);
        }
        if (app && this._options.dashboardPath) {
            app.use(this._options.dashboardPath, this._dashboard);
        }
        return Promise.resolve();
    }

    public onDisconnect() {
        return Promise.resolve();
    }
}
