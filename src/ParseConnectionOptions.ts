export interface IParseConnectionOptions {
    appId: string;
    appName: string;
    masterKey: string;
    fileKey: string;
    serverURL: string;
    maxUploadSize: string;
    [key: string]: any;

    appUser?: string;
    appPass?: string;
    appPath?: string;
    dashboardPath?: string;
    dashboardPrimary?: string;
    dashboardSecondary?: string;
}
