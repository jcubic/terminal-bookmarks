javascript:(function(next) {
    /**
     * Bookmarklet that will create terminal with ANSI rendering
     * on 16colo.rs website (individual ANSI file)
     *
     * Copyright (C) Jakub T. Jankiewicz <https://jcubic.pl>
     * Released under MIT license
     */
    if (window.jQuery) {
        return next(window.jQuery);
    }
    function attr(elem, key, value) {
        elem.setAttribute(document.createAttribute(key, value));
    }
    var script = (function() {
        var head = document.getElementsByTagName('head')[0];
        return function(src) {
            var script = document.createElement('script');
            script.setAttribute('src', src);
            script.setAttribute('type', 'text/javascript');
            head.appendChild(script);
            return script;
        };
    })();
    script('https://cdn.jsdelivr.net/npm/jquery');
    (function delay(time) {
        if (typeof jQuery == 'undefined') {
            setTimeout(delay, time);
        } else {
            next($.noConflict());
        }
    })(500);
})(async function($) {
    var DEBUG = false;
    function init() {
        var t = $('div.terminal');
        if (t.length) {
            t.each(function() {
                $(this).terminal().destroy().remove();
            });
        }
        $('.shell-wrapper').remove();
        var wrapper = $('<div>').addClass('shell-wrapper').appendTo('body');
        var nav = $('<nav/>').appendTo(wrapper);
        var pos; $(document).off('mousemove');
        var height;
        $('nav').off('mousedown mousemove mouseup').mouseup(function() {
            pos = null;
        }).mousedown(function(e) {
            height = wrapper.height();
            pos = e.clientY;
            return false;
        });
        $(document).off('mousemove.terminal').on('mousemove.terminal', function(e) {
            if (pos) {
                wrapper.height(height + (pos - e.clientY));
            }
        });
        $('<span class="shell-destroy">[x]</span>').click(function() {
            term.destroy();
            wrapper.remove();
        }).appendTo(nav);
        function get_buff(url) {
            return fetch(url)
                .then(res => res.arrayBuffer())
                .then(a => new Uint8Array(a));
        }
        function split(buff) {
            var meta = ansi.meta(buff);
            let cols = 80;
            if (meta) {
                buff = buff.slice(0, meta.fileSize);
                cols = meta.tInfo[0];
            }
            var text = iconv.decode(buff, 'CP437');
            text = text.replace(/\x00/g, ' ');
            text = text.replace(/\x0F/g, '*');
            text = text.replace(/\r?\n?\x1b\[A\x1b\[[0-9]+C/g, '');
            return { text, cols };
        }
        function fworker(fn) {
            /* ref: https://stackoverflow.com/a/10372280/387194 */
            var str = '(' + fn.toString() + ')()';
            var URL = window.URL || window.webkitURL;
            var blob;
            try {
                blob = new Blob([str], { type: 'application/javascript' });
            } catch (e) { /* Backwards-compatibility */
                const BlobBuilder = window.BlobBuilder ||
                      window.WebKitBlobBuilder ||
                      window.MozBlobBuilder;
                blob = new BlobBuilder();
                blob.append(str);
                blob = blob.getBlob();
            }
            return new Worker(URL.createObjectURL(blob));
        }
        /* Using webworker to don't freeze the page while ANSI art is processed */
        var worker = fworker(function() {
            var init;
            self.addEventListener('message', function(request) {
                var data = request.data;
                var id = data.id;
                if (data.type !== 'RPC' || id === null) {
                    return;
                }
                function send_result(result) {
                    self.postMessage({ id: id, type: 'RPC', result: result });
                }
                function send_error(message) {
                    self.postMessage({ id: id, type: 'RPC', error: message });
                }
                if (data.method === 'format') {
                    if (!init) {
                        send_error('Worker RPC: not initilized, call init first');
                        return;
                    }
                    var [ string, cols ] = data.params;
                    init.then(function() {
                        try {
                            var output = $.terminal.apply_formatters(string, {
                                unixFormatting: {
                                    escapeBrackets: false,
                                    ansiArt: true
                                }
                            });
                            var lines = $.terminal.split_equal(output, cols);
                            send_result(lines);
                        } catch (e) {
                            console.error(e);
                            send_error(e);
                        }
                    });
                } else if (data.method === 'init') {
                    var url = data.params[0];
                    try {
                        /* minimal jQuery */
                        self.$ = self.jQuery = {
                            fn: {
                                extend: function(obj) {
                                    Object.assign(self.jQuery.fn, obj);
                                }
                            },
                            extend:  Object.assign
                        };
                        var urls = [
                            `${url}/js/jquery.terminal.min.js`,
                            `${url}/js/unix_formatting.js`
                        ];
                        init = new Promise(async function(resolve) {
                            while (urls.length) {
                                var url = urls.shift();
                                var res = await fetch(url);
                                var code = await res.text();
                                try {
                                    eval(code);
                                } catch(e) {
                                    console.error(e);
                                    send_error(e);
                                    init = false;
                                    break;
                                }
                            }
                            resolve();
                        });
                    } catch(e) {
                        send_error(e);
                    }
                }
            });
        });
        var rpc = (function() {
            var id = 0;
            return function rpc(method, params) {
                var _id = ++id;
                return new Promise(function(resolve, reject) {
                    worker.addEventListener('message', function handler(response) {
                        var data = response.data;
                        if (data && data.type === 'RPC' && data.id === _id) {
                            if (data.error) {
                                reject(data.error);
                            } else {
                                resolve(data.result);
                            }
                            worker.removeEventListener('message', handler);
                        }
                    });
                    worker.postMessage({
                        type: 'RPC',
                        method: method,
                        id: _id,
                        params: params
                    });
                });
            };
        })();
        var url;
        if (DEBUG) {
            url = 'https://localhost/projects/jcubic/terminal/repo';
        } else {
            url = 'https://cdn.jsdelivr.net/npm/jquery.terminal';
        }
        var init = rpc('init', [url]).catch((error) => {
            console.error(error);
        });
        async function format(buff) {
            const { cols, text } = split(buff);
            var lines = await rpc('format', [text, cols || 80]);
            /* unix formatting don't handle \r\n at the end */
            if (lines[lines.length - 1] === '') {
                lines.pop();
            }
            return lines;
        }
        function download(text, filename) {
            var a = $('<a download="' + filename + '">x</a>');
            var file = new Blob([text], { type: 'text/plain' });
            var url = URL.createObjectURL(file);
            a.attr('href', url);
            a.appendTo('body')[0].click();
            a.remove();
        }
        $('style.terminal').remove();
        $('<style class="terminal">.terminal { font-size-adjust: none; --size: 1.2;height: calc(100% - 26px); } .shell-wrapper nav {cursor: row-resize; color:#ccc;border-bottom:1px solid #ccc;font-family:monospace;text-align: right;background: black;line-height: initial;} .shell-wrapper {position: fixed;z-index:99999;bottom:0;left:0;right:0;height:350px; }.shell-destroy {padding: 5px;cursor:pointer;display: inline-block;}</style>').appendTo('head');
        var term = $('<div>').appendTo(wrapper).terminal({
            cat: function(name) {
                return get_buff(name);
            },
            less: function(name) {
                get_buff(name).then(buff => format(buff)).then(lines => {
                    this.less(lines, { ansi: true });
                });
            },
            size: function(num) {
                this.css('--size', num);
            },
            download: async function(name) {
                var buff = await get_buff(name);
                const { text } = split(buff);
                download(text, name);
            }
        }, {
            greetings: 'ANSI Terminal Viewer [[!;;;;https://jcubic.pl/me]Jakub T. Jankiewicz]',
            renderHandler: function(obj) {
                if (obj instanceof Uint8Array) {
                    this.echo(format(obj).then(lines => lines.join('\n')), {
                        formatters: false,
                        finalize: function(div) {
                            div.addClass('ansi');
                        }
                    });
                    return false;
                }
                return obj;
            }
        });
        $.terminal.defaults.formatters = [
            $.terminal.from_ansi,
            $.terminal.nested_formatting
        ];
        term.exec(`less ${$('.filelink').attr('href')}`);
    }
    ['https://cdn.jsdelivr.net/npm/jquery.terminal@2.x.x/css/jquery.terminal.min.css'
    ].forEach(function(url) {
        if (!$('link[href="' + url + '"]').length) {
            var link = $('<link href="' + url + '" rel="stylesheet"/>');
            var head = $('head');
            if (head.length) {
                link.appendTo(head);
            } else {
                link.appendTo('body');
            }
        }
    });
    var script = [
        'https://cdn.jsdelivr.net/combine/npm/jquery.terminal@2.x.x',
        'npm/jquery.terminal@2.x.x/js/less.js',
        'gh/jcubic/jquery.terminal@devel/js/unix_formatting.js',
        'npm/js-polyfills/keyboard.js',
        'npm/ansidec',
        'gh/jcubic/static/js/iconv.js',
        'gh/jcubic/static/js/wcwidth.js'
    ];
    if ($.terminal && $.terminal.from_ansi) {
        init();
    } else if (DEBUG) {
        var unix = 'https://localhost/~kuba/jcubic/terminal/repo/js/unix_formatting.js';
        var less = 'https://localhost/~kuba/jcubic/terminal/repo/js/less.js';
        var scripts = [script.join(','), unix, less];
        (function loop() {
            if (!scripts.length) {
                return init();
            }
            var script = scripts.shift();
            $.getScript(script, loop);
        })();
    } else {
        $.getScript(script.join(','), init);
    }
});
