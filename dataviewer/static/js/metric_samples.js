/* Plan a query using already displayed samples. Ownership/lifetime stays with each panel. */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MetricSamples = api;
}(typeof window === 'undefined' ? this : window, function () {
    'use strict';
    function plan(groups, available) {
        var query = Object.create(null), reused = new Map();
        Object.keys(groups).forEach(function (key) {
            var missing = groups[key].Sig.filter(function (name) {
                if (!available.has(name)) return true;
                reused.set(name, available.get(name)); return false;
            });
            // Keep empty-group requests on their existing validation path.
            if (missing.length || !groups[key].Sig.length) query[key] = Object.assign({}, groups[key], { Sig: missing });
        });
        return {
            query: query,
            merge: function (response) {
                var result = Object.create(null);
                Object.keys(groups).forEach(function (key) {
                    var received = response[key], values = Object.create(null);
                    groups[key].Sig.forEach(function (name) {
                        if (reused.has(name)) values[name] = reused.get(name);
                        else if (received && Object.prototype.hasOwnProperty.call(received.Sig, name)) {
                            values[name] = received.Sig[name];
                        }
                    });
                    result[key] = Object.assign({}, groups[key], received, { Sig: values });
                });
                return result;
            }
        };
    }
    return { plan: plan };
}));
