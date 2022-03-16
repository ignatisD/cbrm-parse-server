import * as Parse from "parse/node";
import { without, escapeRegExp } from "lodash";
import {
    Configuration,
    IFilter,
    IMappingResponse,
    IPaginatedResults,
    IPopulate,
    IQuery,
    IRepositoryBase, JsonResponse, Logger,
    NewAble, Pagination, Query,
    Repository
} from "@ignatisd/cbrm";

export class ParseRepositoryBase<T extends Parse.Attributes = any> extends Repository<NewAble<Parse.Object<T>>> implements IRepositoryBase<T> {

    public textFields: string[] = [];
    protected autopopulate: IPopulate[] = [];

    protected _schema: Record<string, Parse.Schema.TYPE> = {};
    protected hide: Record<string, boolean> = {};

    constructor(modelName: string) {
        super(Parse.Object.extend(modelName));
    }

    public query() {
        return new Parse.Query<Parse.Object<T>>(this.modelName);
    }
    public schema() {
        return this._schema;
    }

    public fromQuery(terms: IQuery, query: Parse.Query<Parse.Object<T>> = null): Parse.Query<any> {
        if (terms.raw) {
            return terms.raw;
        }
        query = query ?? this.query();
        if (typeof terms.options.limit !== "undefined") {
            const limit = terms.options.limit || 0;
            const page = terms.options.page || 1;
            const offset = (page - 1) * limit;
            query.limit(limit);
            if (!terms.scroll && offset) {
                query.skip(offset);
            }
        }
        let toSelect: string[] = [];
        if (terms.projection) {
            Object.keys(this._schema).forEach(key => {
                if (!this.hide[key]) {
                    toSelect.push(key);
                }
            });
            const toSelectProjection = [];
            const toNotSelectProjection = [];
            Object.keys(terms.projection).forEach((p) => {
                if (terms.projection[p]) {
                    if (!this.hide[p]) {
                        toSelectProjection.push(p);
                    }
                } else {
                    toNotSelectProjection.push(p);
                }
            });
            if (toNotSelectProjection.length) {
                toSelect = toSelect.filter(s => toNotSelectProjection.indexOf(s) === -1);
            } else if (toSelectProjection.length) {
                toSelect = toSelectProjection;
            }
        }
        if (terms.options.populate.length) {
            for (const pop of terms.options.populate) {
                let selects = [];
                if (pop.select && typeof pop.select === "string") {
                    if (pop.select.includes(",")) {
                        selects = pop.select.split(",");
                    } else {
                        selects = pop.select.split(" ");
                    }
                } else if (Array.isArray(pop.select)) {
                    selects = pop.select;
                }
                if (!selects.length) {
                    query.include(pop.path);
                    if (toSelect.length) {
                        toSelect.push(pop.path);
                    }
                } else {
                    selects.map(s => {
                        query.include(`${pop.path}.${s}`);
                        if (toSelect.length) {
                            toSelect.push(`${pop.path}.${s}`);
                        }
                    });
                }
            }
        }
        if (toSelect.length > 0) {
            query.select(toSelect);
        }
        if (terms.id) {
            query.equalTo("objectId", <any>terms.id);
        }
        const filters = terms.opFilters;
        filters.forEach((filter) => {
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

    protected _scopeOptions(params?: IQuery, useMasterKey: boolean = false) {
        const opts: Parse.ScopeOptions = {};
        if (useMasterKey) {
            opts.useMasterKey = true;
        } else if (params?.useMasterKey) {
            opts.useMasterKey = true;
        } else if (params?.token) {
            opts.sessionToken = params.token;
        } else if (this._user?.sessionId) {
            opts.sessionToken = this._user.sessionId;
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
        if (filter.key === "_id") {
            filter.key = "objectId"; // TODO check conflicts
        }
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
                        subQueries.push(this.fromQuery(v));
                    }
                }
                if (!subQueries.length) {
                    break;
                }
                try {
                    if (filter.key === "or") {
                        // @ts-ignore
                        query._orQuery(subQueries);
                    } else if (filter.key === "not") {
                        // @ts-ignore
                        query._norQuery(subQueries);
                    } else {
                        // @ts-ignore
                        query ._andQuery(subQueries);
                    }
                } catch (e) {
                    Logger.exception(e);
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

    public paginate(docs: T[], paging: IPaginatedResults<T>) {
        docs = docs || [];
        paging = paging || new Pagination<T>();
        return new Pagination<T>()
            .setLimit(paging.limit || Configuration.get("pagingLimit"))
            .setPage(paging.page || 1)
            .setTotal(paging.total || docs.length)
            .addResults(docs)
            .toObject();
    }

    async ensureMapping(mode?: any) {
        const json = new JsonResponse();
        try {
            const allowedTypes: Parse.Schema.TYPE[] = [
                "String",
                "Number",
                "Boolean",
                "Date",
                "Array",
                "Object",
                "Pointer",
                "Relation",
                "File",
                "GeoPoint",
            ];
            const schema = new Parse.Schema(this.modelName);
            const schemaState = await schema.get();
            if (!schemaState) {
                return json.error(`Schema not found: '${this.modelName}'`);
            }
            const excluded = [
                "objectId",
                "createdAt",
                "updatedAt",
                "ACL",
            ];
            const schemaKeys = without(Object.keys(this._schema), ...excluded);
            if (!Object.keys(schemaKeys).length) {
                return json.error("You need to fill the schema first");
            }
            const existingSchemaKeys = without(Object.keys(schemaState.fields), ...excluded);
            const changes = {};
            for (const key of schemaKeys) {
                const schemaType = this._schema[key];
                if (allowedTypes.indexOf(schemaType) === -1) {
                    Logger.warning(`Unrecognized Parse.Schema type '${schemaType}' for field '${key}'`);
                    continue;
                }
                if (existingSchemaKeys.indexOf(key) === -1) {
                    schema.addField(key, this._schema[key]);
                    changes[key] = 1;
                }
            }
            for (const key of existingSchemaKeys) {
                if (schemaKeys.indexOf(key) === -1) {
                    schema.deleteField(key);
                    changes[key] = -1;
                }
            }
            if (Object.keys(changes).length) {
                if (mode?.force) {
                    await schema.update();
                }
                return json.ok(changes, "Changes detected");
            }
            return json.ok(changes, "No changes detected");
        } catch (e) {
            Logger.exception(e, this.repoUser, "updateSchema");
            return json.exception(e);
        }
    }

    public mapping(modelOnly?: boolean): IMappingResponse {
        return {
            model: this.modelName,
            mapping: null // TODO generate mapping
        };
    }

    async populate(docs: T, st: IQuery): Promise<T>;
    async populate(docs: T[], st: IQuery): Promise<T[]>;
    async populate(docs: T[]|T, st: IQuery) {
        return super.populate(docs, st);
    }

    async create(item: Partial<T>, userMasterKey: boolean = false): Promise<JsonResponse<T>> {
        const response = new JsonResponse<T>();
        try {
            const model: any = new this._model();
            for (let prop in item) {
                if (!item.hasOwnProperty(prop) || prop === "objectId") {
                    continue;
                }
                model.set(prop, item[prop]);
            }
            const result = await model.save(null, this._scopeOptions(null, userMasterKey));
            return response.ok(result);
        } catch (e) {
            Logger.exception(e, this.repoUser);
            return response.exception(e);
        }
    }
    async createMany(items: Partial<T>[], userMasterKey: boolean = false) {
        const response = new JsonResponse();
        try {
            const models = [];
            for (let item of items) {
                const model: any = new this._model();
                for (let prop in item) {
                    if (!item.hasOwnProperty(prop) || prop === "objectId") {
                        continue;
                    }
                    model.set(prop, item[prop]);
                }
                models.push(model);
            }
            const result = await Parse.Object.saveAll(models, this._scopeOptions(null, userMasterKey));
            return response.ok(result);
        } catch (e) {
            Logger.exception(e, this.repoUser);
            return response.exception(e);
        }
    }
    async insertMany(items: Partial<T>[], userMasterKey: boolean = false) {
        return this.createMany(items, userMasterKey);
    }

    async count(q: IQuery) {
        const st = Query.clone(q);
        st.populate([]);
        st.setPaging(1, -1);
        const query = this.fromQuery(q, this.query());
        return query.count(this._scopeOptions(q));
    }
    async retrieve(q: IQuery): Promise<IPaginatedResults<T>> {
        let count: number = 0;
        const docs = await this.find(q);
        if (docs?.length >= q?.options?.limit) {
            count = await this.count(q);
        }
        /** @ts-ignore */
        return this.paginate(docs, Pagination.fromQuery(q, count));
    }
    async search(q: IQuery): Promise<IPaginatedResults<T>> {
        return this.retrieve(q);
    }
    async find(q: IQuery): Promise<T[]> {
        const st = this._prepareQuery(q);
        if (st.options.lean) {
            st.options.populate = [];
        }
        const query = this.fromQuery(st, this.query());
        let results = (await query.find(this._scopeOptions(st))) || [];
        if (st.options.lean && q?.options?.populate?.length && results.length) {
            results = results.map(r => r.toJSON());
            const popQ = Query.mimic(q);
            popQ.setLean(true);
            popQ.populate(q.options.populate);
            results = await this.populate(results, popQ);
        }
        return results;
    }
    async findById(params: IQuery) {
        return this.findOne(params);
    }
    async findOne(q: IQuery) {
        const st = this._prepareQuery(q);
        if (st.options.lean) {
            st.options.populate = [];
        }
        const query = this.fromQuery(st, this.query());
        let doc = await query.first(this._scopeOptions(st));
        if (doc && st.options.lean && q?.options?.populate?.length) {
            doc = doc.toJSON();
            const popQ = Query.mimic(q);
            popQ.setLean(true);
            popQ.populate(q.options.populate);
            doc = await this.populate(doc, popQ);
        }
        return doc;
    }

    async updateOne(id: string, item: Partial<T>, userMasterKey: boolean = false) {
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
            const result = await model.save(null, this._scopeOptions(null, userMasterKey));
            return response.ok(result);
        } catch (e) {
            Logger.exception(e, this.repoUser);
            return response.exception(e);
        }
    }
    async updateMany(filters: any, props?: Partial<T>, userMasterKey: boolean = false) {
        return JsonResponse.notImplemented();
    }
    async updateOrCreate(filters: any, item?: Partial<T>, userMasterKey: boolean = false) {
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
            const result = await model.save(null, this._scopeOptions(null, userMasterKey));
            return response.ok(result);
        } catch (e) {
            Logger.exception(e, this.repoUser);
            return response.exception(e);
        }
    }
    async updateOrCreateMany(items: Partial<T>[], props?: any, userMasterKey: boolean = false) {
        return JsonResponse.notImplemented();
    }

    async deleteById(id: string, userMasterKey: boolean = false) {
        const response = new JsonResponse();
        try {
            const model = await this.query().get(id);
            if (!model) {
                return response.error("Not found");
            }
            const result = await model.destroy(this._scopeOptions(null, userMasterKey));
            return response.ok(result);
        } catch (e) {
            Logger.exception(e, this.repoUser);
            return response.exception(e);
        }
    }
    async deleteOne(q: Query, userMasterKey: boolean = false) {
        const response = new JsonResponse();
        try {
            const st = this._prepareQuery(q);
            const query = this.fromQuery(st, this.query());
            const model = await query.first(this._scopeOptions(st));
            if (!model) {
                return response.error("Not found");
            }
            const result = await model.destroy(this._scopeOptions(q, userMasterKey));
            return response.ok(result);
        } catch (e) {
            Logger.exception(e, this.repoUser);
            return response.exception(e);
        }
    }
    async deleteMany(q: IQuery, userMasterKey: boolean = false) {
        const response = new JsonResponse();
        try {
            const results: any[] = await this.find(q);
            if (!results?.length) {
                return response.error("Not found");
            }
            const result = await Parse.Object.destroyAll(results, this._scopeOptions(q, userMasterKey));
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
