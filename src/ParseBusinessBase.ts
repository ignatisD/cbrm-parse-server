import { Business, IBusinessBase, IMappingResponse, IPaginatedResults, JsonResponse, IQuery } from "@ignatisd/cbrm";
import { ParseRepositoryBase } from "./ParseRepositoryBase";

export class ParseBusinessBase<T = any> extends Business<T> implements IBusinessBase<T> {

    protected _repo: ParseRepositoryBase;

    protected constructor(repo: ParseRepositoryBase) {
        super(repo);
    }

    public async ensureMapping(mode?: any) {
        return this._repo.ensureMapping(mode);
    }

    public getMapping(modelOnly?: boolean): IMappingResponse {
        return this._repo.mapping(modelOnly);
    }

    public async create(item: T, userMasterKey: boolean = false) {
        return this._repo.create(item, userMasterKey);
    }

    public async createMany(items: T[], userMasterKey: boolean = false) {
        return this._repo.createMany(items, userMasterKey);
    }

    public async updateOrCreate(filters: any, item: Partial<T>, userMasterKey: boolean = false) {
        return this._repo.updateOrCreate(filters, item, userMasterKey);
    }

    public async updateOrCreateMany(items: Partial<T>[], userMasterKey: boolean = false) {
        return this._repo.updateOrCreateMany(items, userMasterKey);
    }

    public async search(q: IQuery): Promise<IPaginatedResults<T>> {
        return this._repo.search(q);
    }

    public async retrieve(q: IQuery): Promise<IPaginatedResults<T>> {
        return this._repo.retrieve(q);
    }

    public async find(q: IQuery): Promise<T[]> {
        return this._repo.find(q);
    }

    public async findById(q: IQuery): Promise<T> {
        return this._repo.findById(q);
    }

    public async findOne(q: IQuery): Promise<T> {
        return this._repo.findOne(q);
    }

    public async update(_id: string, item: Partial<T>, userMasterKey: boolean = false) {
        return this._repo.updateOne(_id, item, userMasterKey);
    }

    public async updateMany(terms: IQuery, item: Partial<T>|any, userMasterKey: boolean = false) {
        return this._repo.updateMany(terms, item);
    }

    public async updateManyWithDifferentValues(items: Partial<T>[], userMasterKey: boolean = false) {
        return JsonResponse.notImplemented();
    }

    public async delete(_id: string, userMasterKey: boolean = false) {
        return this._repo.deleteById(_id, userMasterKey);
    }

    public async deleteMany(q: IQuery) {
        return this._repo.deleteMany(q);
    }

    public async count(q: IQuery): Promise<number> {
        return this._repo.count(q);
    }

    public async restore(id: string): Promise<JsonResponse> {
        return Promise.resolve(JsonResponse.notImplemented());
    }

    public async duplicate(q: IQuery): Promise<JsonResponse> {
        return Promise.resolve(JsonResponse.notImplemented());
    }
}
