import * as Parse from "parse/node";
import { escapeRegExp } from "lodash";
import Repository from "@ignatisd/cbrm/lib/repository/Repository";
import IRepositoryBase from "@ignatisd/cbrm/lib/interfaces/repository/RepositoryBase";
import { IFilter, IPopulate, IQuery } from "@ignatisd/cbrm/lib/interfaces/helpers/Query";
import IPaginatedResults from "@ignatisd/cbrm/lib/interfaces/helpers/PaginatedResults";
import Query from "@ignatisd/cbrm/lib/helpers/Query";
import JsonResponse from "@ignatisd/cbrm/lib/helpers/JsonResponse";
import Logger from "@ignatisd/cbrm/lib/helpers/Logger";

export abstract class ParseRepositoryBase<T = any> extends Repository<Parse.ObjectConstructor> implements IRepositoryBase<T> {

    public textFields: string[] = [];
    protected autopopulate: IPopulate[] = [];
    protected _blacklist: Record<string, boolean> = {};
    protected _useMasterKey: boolean = false;

    protected constructor(modelName: string) {
        super(Parse.Object.extend(modelName));
    }

    public query() {
        return new Parse.Query<Parse.Object<T>>(this.model);
    }

    public build(terms: IQuery, query: Parse.Query<any> = null): Parse.Query<Parse.Object<T>> {
        if (terms.raw) {
            return terms.raw;
        }
        const limit = terms.options.limit || 0;
        const page = terms.options.page || 1;
        const offset = (page - 1) * limit;
        query = query ?? this.query();
        query.limit(limit);

        if (!terms.scroll) {
            query.skip(offset);
        }

        if (terms.projection) {
            const projection = {
                excludes: [],
                includes: [],
            };
            Object.keys(terms.projection).forEach((p) => {
                if (!terms.projection[p]) {
                    projection.excludes.push(p);
                } else {
                    projection.includes.push(p);
                }
            });
            if (projection.excludes.length === 0) {
                delete projection.excludes;
            }
            if (projection.includes.length === 0) {
                delete projection.includes;
            }
            query.select(projection.includes);
        }
        if (terms.id) {
            query.equalTo("objectId", terms.id);
        }
        const filters = terms.opFilters;
        filters.forEach((filter: IFilter) => {
            this._handleFilter(filter, query);
        });
        if (terms.options.sort) {
            for (let key in terms.options.sort) {
                if (!terms.options.sort.hasOwnProperty(key)) {
                    continue;
                }
                if (terms.options.sort[key] === 1) {
                    query.addAscending(key);
                } else {
                    query.addDescending(key);
                }
            }
        }
        return query;
    }

    public useMasterKey(state: boolean = true) {
        // nullish coalescing operator ( checks for null | undefined )
        state = state ?? !this._useMasterKey;
        this._useMasterKey = state;
        return this;
    }

    protected _scopeOptions(params?: IQuery) {
        const opts: Parse.ScopeOptions = {};
        if (params?.token === "useMasterKey") {
            opts.useMasterKey = true;
        } else if (params?.token) {
            opts.sessionToken = params.token;
        } else if (this._user?.sessionId) {
            opts.sessionToken = this._user.sessionId;
        } else if (this._useMasterKey) {
            opts.useMasterKey = true;
        }
        return opts;
    }

    protected _toArray(value: any): any[] {
        if (Array.isArray(value)) {
            return value;
        } else if (typeof value === "string" && value.indexOf("|") !== -1) {
            return value.split("|");
        } else {
            return [value];
        }
    }

    protected _handleFilter(filter: IFilter, query: Parse.Query<any>) {
        let val: any[];
        switch (filter.op) {
            case "$exists":
                if (filter.value) {
                    query.exists(filter.key);
                } else {
                    query.doesNotExist(filter.key);
                }
                break;
            case "$in":
            case "$elemMatch":
                val = this._toArray(filter.value);
                query.containedIn(filter.key, val);
                break;
            case "$nin":
                val = this._toArray(filter.value);
                query.notContainedIn(filter.key, filter.value);
                break;
            case "$ne":
                query.notEqualTo(filter.key, filter.value);
                break;
            case "$regex":
                query.matches(filter.key, escapeRegExp(filter.value));
                break;
            case "$lt":
                query.lessThan(filter.key, filter.value);
                break;
            case "$lte":
                query.lessThanOrEqualTo(filter.key, filter.value);
                break;
            case "$gt":
                query.greaterThan(filter.key, filter.value);
                break;
            case "$gte":
                query.greaterThanOrEqualTo(filter.key, filter.value);
                break;
            case "$or":
                query.contains(filter.key, filter.value);
                break;
            case "$and":
                val = this._toArray(filter.value);
                query.containsAll(filter.key, val);
                break;
            case "$bool":
                if (!Array.isArray(filter.value)) {
                    filter.value = [filter.value];
                }
                const subQueries: Parse.Query<any>[] = [];
                for (let v of filter.value) {
                    if (v?.opFilters?.length) {
                        subQueries.push(this.build(v.opFilters));
                    }
                }
                if (!subQueries.length) {
                    break;
                }
                if (filter.key === "or") {
                    query = Parse.Query.or(query, ...subQueries);
                } else if (filter.key === "not") {
                    query = Parse.Query.nor(query, ...subQueries);
                } else {
                    query = Parse.Query.and(query, ...subQueries);
                }
                break;
            case "$nested":
                if (typeof filter.value !== "object") {
                    query.equalTo(filter.key, filter.value);
                    break;
                }
                let subQuery = this.query();
                if (filter.value?.op && filter.value.key && filter.value.value !== undefined) {
                    this._handleFilter({
                        key: filter.value.key,
                        value: filter.value.value,
                        op: filter.value.op
                    }, subQuery);
                } else if (Array.isArray(filter.value)) {
                    for (let f of filter.value) {
                        if (f?.op && f.key && f.value !== undefined) {
                            this._handleFilter({
                                key: f.key,
                                value: f.value,
                                op: f.op
                            }, subQuery);
                        }
                    }
                } else {
                    for (let key in filter.value) {
                        if (!filter.value.hasOwnProperty(key)) {
                            continue;
                        }
                        this._handleFilter({
                            key: key,
                            value: filter.value[key],
                            op: "$eq"
                        }, subQuery);
                    }
                }
                query.matchesQuery(filter.key, subQuery);
                break;
            case "$eq":
            default:
                query.equalTo(filter.key, filter.value);
                break;
        }
    }

    protected _prepareQuery(q: IQuery) {
        const st = Query.clone(q);
        st.searchIn(this.textFields);
        if (st.options.autopopulate && !st.options.populate.length && this.autopopulate.length) {
            st.options.populate = this.autopopulate;
        }
        return st;
    }

    async ensureMapping() {
        return Promise.resolve();
    }

    async create(item: Partial<T>) {
        const response = new JsonResponse();
        try {
            const model = new this._model();
            for (let prop in item) {
                if (!item.hasOwnProperty(prop) || prop === "objectId") {
                    continue;
                }
                model.set(prop, item[prop]);
            }
            const result = await model.save(null, this._scopeOptions());
            return response.ok(result);
        } catch (e) {
            Logger.exception(e, this.repoUser);
            return response.exception(e);
        }
    }
    async createMany(items: Partial<T>[]) {
        const response = new JsonResponse();
        try {
            const models = [];
            for (let item of items) {
                const model = new this._model();
                for (let prop in item) {
                    if (!item.hasOwnProperty(prop) || prop === "objectId") {
                        continue;
                    }
                    model.set(prop, item[prop]);
                }
                models.push(model);
            }
            const result = await Parse.Object.saveAll(models, this._scopeOptions());
            return response.ok(result);
        } catch (e) {
            Logger.exception(e, this.repoUser);
            return response.exception(e);
        }
    }
    async insertMany(items: Partial<T>[]) {
        return this.createMany(items);
    }

    async count(q: IQuery) {
        const st = this._prepareQuery(q);
        const query = this.build(st, this.query());
        return query.count(this._scopeOptions(st));
    }
    async retrieve(q: IQuery): Promise<IPaginatedResults<T>> {
        const docs = await this.find(q);
        return this.emptyPaginatedResults(docs);
    }
    async search(q: IQuery): Promise<IPaginatedResults<T>> {
        return this.retrieve(q);
    }
    async find(q: IQuery) {
        const st = this._prepareQuery(q);
        const query = this.build(st, this.query());
        return query.find(this._scopeOptions(st));
    }
    async findById(params: IQuery) {
        return this.findOne(params);
    }
    async findOne(q: IQuery) {
        const st = this._prepareQuery(q);
        const query = this.build(st, this.query());
        return query.first(this._scopeOptions(st));
    }

    async updateOne(id: string, item: Partial<T>) {
        const response = new JsonResponse();
        try {
            const model = await this.query().get(id);
            if (!model) {
                return response.error("Not found");
            }
            for (let prop in item) {
                if (!item.hasOwnProperty(prop) || prop === "objectId") {
                    continue;
                }
                model.set(prop, <any>item[prop]);
            }
            const result = await model.save(null, this._scopeOptions());
            return response.ok(result);
        } catch (e) {
            Logger.exception(e, this.repoUser);
            return response.exception(e);
        }
    }
    async updateMany(filters: any, props?: Partial<T>) {
        return JsonResponse.notImplemented();
    }
    async updateOrCreate(filters: any, item?: Partial<T>) {
        const response = new JsonResponse();
        try {
            const q = new Query().setFilters(filters);
            let model: any = await this.findOne(q);
            if (!model) {
                model = new this._model();
            }
            for (let prop in item) {
                if (!item.hasOwnProperty(prop)) {
                    continue;
                }
                model.set(prop, item[prop]);
            }
            const result = await model.save(null, this._scopeOptions());
            return response.ok(result);
        } catch (e) {
            Logger.exception(e, this.repoUser);
            return response.exception(e);
        }
    }
    async updateOrCreateMany(items: Partial<T>[], props?: any) {
        return JsonResponse.notImplemented();
    }

    async deleteById(id: string) {
        const response = new JsonResponse();
        try {
            const model = await this.query().get(id);
            if (!model) {
                return response.error("Not found");
            }
            const result = await model.destroy(this._scopeOptions());
            return response.ok(result);
        } catch (e) {
            Logger.exception(e, this.repoUser);
            return response.exception(e);
        }
    }
    async deleteOne(q: Query) {
        const response = new JsonResponse();
        try {
            const st = this._prepareQuery(q);
            const query = this.build(st, this.query());
            const model = await query.first(this._scopeOptions(st));
            if (!model) {
                return response.error("Not found");
            }
            const result = await model.destroy(this._scopeOptions());
            return response.ok(result);
        } catch (e) {
            Logger.exception(e, this.repoUser);
            return response.exception(e);
        }
    }
    async deleteMany(q: Query) {
        const response = new JsonResponse();
        try {
            const results = await this.find(q);
            if (!results?.length) {
                return response.error("Not found");
            }
            const result = await Parse.Object.destroyAll(results, this._scopeOptions());
            return response.ok(result);
        } catch (e) {
            Logger.exception(e, this.repoUser);
            return response.exception(e);
        }
    }

    async aggregate<V = any>(pipeline: Parse.Query.AggregationOptions | Parse.Query.AggregationOptions[], query?: Parse.Query<Parse.Object<T>>): Promise<V> {
        query = query ?? this.query();
        return query.aggregate(pipeline);
    }
}
