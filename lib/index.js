const { readdirSync } = require('fs')
const path = require('path')
const bp = require('./index')
const assert = require('assert')

const methods = ['get', 'post', 'patch', 'del', 'options', 'put']

class Blueprint {
    constructor() {
        this.router = {}
        this._prefix = {}
        this._params = {}
        this.restfulClass = this.restfulClass.bind(this)
        this.setRouter = this.setRouter.bind(this)
        this.getRoute = this.getRoute.bind(this)
    }

    scanController() {
        const dir = path.resolve()
        readdirSync(dir + '/app/controller').forEach(file => {
            require(dir + '/app/controller/' + file)
        })
    }

    setRouter(urls, blueprint) {
        const prefixUrl = this._prefix[blueprint.ClassName]
        const url = prefixUrl ? prefixUrl + urls : urls

        const _bp = this.router[url]
        if (_bp) {
            //check method if existed
            for (const index in _bp) {
                const object = _bp[index]
                if (object.httpMethod === blueprint.httpMethod) {
                    throw new Error(
                        `URL * ${object.httpMethod.toUpperCase()} ${url} * existed`
                    )
                }
            }
            //not existed
            this.router[url].push(blueprint)
        } else {
            this.router[url] = []
            this.router[url].push(blueprint)
        }
    }

    /**
     * crud
     *
     * Get(); => http GET
     *
     * Post(); => http POST
     *
     * Del(); => http DELETE
     *
     * Put(); => http PUT
     * @param url
     */
    restfulClass(url, fn) {
        return Class => {
            ;['Get', 'Post', 'Del', 'Put'].forEach(httpMethod => {
                const lowercase = httpMethod.toLowerCase()
                const handler = Class.prototype[httpMethod]
                this.setRouter(url, {
                    httpMethod: lowercase,
                    constructor: Class,
                    handler: httpMethod,
                    beforeFunction: fn
                })
            })
        }
    }
    getRoute() {
        // this.scanController()
        return this.router
    }

    prefix(url, controllerName) {
        this._prefix[controllerName] = url
    }
}

methods.forEach(httpMethod => {
    Object.defineProperty(Blueprint.prototype, httpMethod, {
        get: function () {
            return (url, fn) => {
                return (target, propertyKey) => {
                    this.setRouter(url, {
                        httpMethod: httpMethod,
                        constructor: target.constructor,
                        handler: propertyKey,
                        beforeFunction: fn,
                        ClassName: target.constructor.name
                    })
                }
            }
        }
    })
})

const bpInstance = new Blueprint()


const paramsNames = ['Body', 'Query', 'Params']

paramsNames.forEach(paramsName => {
    exports[paramsName] = (key = '', schema) => {
        return (target, propertyKey, index) => {
            const paramsNameLower = paramsName.toLowerCase()
            // 包含校验信息
            if (key && key.includes('.') || typeof key === 'object') {
                schema = key
                key = ''
            }
            const ClassName = target.constructor.name
            // 写入到配置中
            bpInstance._params[ClassName] = bpInstance._params[ClassName] || {}
            bpInstance._params[ClassName][propertyKey] = bpInstance._params[ClassName][propertyKey] || {}
            bpInstance._params[ClassName][propertyKey][index] = {
                name: paramsNameLower,
                key,
                schema,
            }
        }
    }
})

exports.Blueprint = (app, options) => {
    const { router } = app
    if (options && options.prefix) {
        router.prefix(options.prefix)
    }
    const r = bpInstance.getRoute()
    Object.keys(r).forEach(url => {
        r[url].forEach(object => {
            console.log(url, '--->')

            // 构造参数注入器
            const { ClassName, handler } = object
            if (bpInstance._params[ClassName] && bpInstance._params[ClassName][handler]) {
                const paramsInfo = bpInstance._params[ClassName][handler]
                object._params = []
                Object.values(paramsInfo).forEach(({ name, key, schema }) => {
                    object._params.push({ name, key, schema })
                })
            }

            router[object.httpMethod](url, async ctx => {
                // create a new Controller
                const instance = new object.constructor(ctx)
                //run beforeFunction
                const beforeRes =
                    object.beforeFunction &&
                    (await object.beforeFunction(ctx, instance))
                if (beforeRes === false) return

                const args = []
                if (object._params) {
                    object._params.forEach((info) => {
                        const { name, key, schema } = info
                        let data = ctx.request.body
                        if (name) {
                            data = ctx.request[name]
                            if (key) {
                                data = data[key]
                            }
                            if (schema) {
                                // data = validate(data, schema)
                                // TODO validate
                            }
                        }
                        args.push(data)
                    })
                }


                const responseBody = await instance[object.handler](...args)
                if (!ctx.body && responseBody) {
                    ctx.body = responseBody
                }
            })
        })
    })
}

exports.bp = bpInstance
