/*
 * MelonJS Game Engine
 * Copyright (C) 2011 - 2018 Olivier Biot
 * http://www.melonjs.org
 *
 */
(function () {

    /**
     * a WebGL renderer object
     * @extends me.Renderer
     * @namespace me.WebGLRenderer
     * @memberOf me
     * @constructor
     * @param {HTMLCanvasElement} canvas The html canvas tag to draw to on screen.
     * @param {Number} width The width of the canvas without scaling
     * @param {Number} height The height of the canvas without scaling
     * @param {Object} [options] The renderer parameters
     * @param {Boolean} [options.doubleBuffering=false] Whether to enable double buffering
     * @param {Boolean} [options.antiAlias=false] Whether to enable anti-aliasing
     * @param {Boolean} [options.failIfMajorPerformanceCaveat=true] If true, the renderer will switch to CANVAS mode if the performances of a WebGL context would be dramatically lower than that of a native application making equivalent OpenGL calls.
     * @param {Boolean} [options.transparent=false] Whether to enable transparency on the canvas (performance hit when enabled)
     * @param {Boolean} [options.subPixel=false] Whether to enable subpixel renderering (performance hit when enabled)
     * @param {Number} [options.zoomX=width] The actual width of the canvas with scaling applied
     * @param {Number} [options.zoomY=height] The actual height of the canvas with scaling applied
     * @param {me.WebGLRenderer.Compositor} [options.compositor] A class that implements the compositor API
     */
    me.WebGLRenderer = me.Renderer.extend(
    /** @scope me.WebGLRenderer.prototype */
    {
        /**
         * @ignore
         */
        init : function (c, width, height, options) {
            this._super(me.Renderer, "init", [c, width, height, options]);

            this.canvasScaleFactor = options.scale;

            /**
             * The WebGL context
             * @name gl
             * @memberOf me.WebGLRenderer
             */
            this.context = this.gl = this.getContextGL(c, this.transparent);

            /**
             * @ignore
             */
            this._colorStack = [];

            /**
             * @ignore
             */
            this._matrixStack = [];

            /**
             * @ignore
             */
            this._scissorStack = [];

            /**
             * @ignore
             */
            this._linePoints = [
                new me.Vector2d(),
                new me.Vector2d(),
                new me.Vector2d(),
                new me.Vector2d()
            ];

            /**
             * The current transformation matrix used for transformations on the overall scene
             * @name currentTransform
             * @type me.Matrix2d
             * @memberOf me.WebGLRenderer
             */
            this.currentTransform = new me.Matrix2d();

            // Create a compositor
            var Compositor = options.compositor || me.WebGLRenderer.Compositor;
            this.compositor = new Compositor(this);


            // default WebGL state(s)
            this.gl.disable(this.gl.DEPTH_TEST);
            this.gl.disable(this.gl.SCISSOR_TEST);
            this.gl.enable(this.gl.BLEND);

            // set default mode
            this.setBlendMode(this.gl, options.blendMode);

            // Create an array for texture cache
            this.cache = new me.Renderer.TextureCache(
                this.compositor.maxTextures
            );

            this.createFillTexture(this.cache);

            // Configure the WebGL viewport
            this.scaleCanvas(1, 1);

            return this;
        },

        /**
         * Reset context state
         * @name reset
         * @memberOf me.WebGLRenderer
         * @function
         */
        reset : function () {
            this._super(me.Renderer, "reset");
            this.compositor.reset();
            this.gl.disable(this.gl.SCISSOR_TEST);
            this.createFillTexture(this.cache);
        },

        /**
         * resets the gl transform to identity
         * @name resetTransform
         * @memberOf me.WebGLRenderer
         * @function
         */
        resetTransform : function () {
            this.currentTransform.identity();
        },

        /**
         * @ignore
         */
        createFillTexture : function (cache) {
            if (typeof this.fillTexture === "undefined") {
                // Create a 1x1 white texture for fill operations
                var image = new Uint8Array([255, 255, 255, 255]);
                /**
                 * @ignore
                 */
                this.fillTexture = new this.Texture(
                    this.Texture.prototype.createAtlas.apply(
                        this.Texture.prototype,
                        [ 1, 1, "fillTexture"]
                    ),
                    image,
                    cache
                );
                // XXX better way to disable this
                this.fillTexture.premultipliedAlpha = false;
            } else {
                // fillTexture was already created, just add it back into the cache
                cache.put(this.fillTexture.source, this.fillTexture);
            }

            this.compositor.uploadTexture(
                this.fillTexture,
                1,
                1,
                0
            );
        },

        /**
         * @ignore
         */
        createFontTexture : function (cache) {
            var image = me.video.createCanvas(
                me.Math.nextPowerOfTwo(this.backBufferCanvas.width),
                me.Math.nextPowerOfTwo(this.backBufferCanvas.height)
            );

            /**
             * @ignore
             */
            this.fontContext2D = this.getContext2d(image);

            /**
             * @ignore
             */
            this.fontTexture = new this.Texture(
                this.Texture.prototype.createAtlas.apply(
                    this.Texture.prototype,
                    [ this.backBufferCanvas.width, this.backBufferCanvas.height, "fontTexture"]
                ),
                image,
                cache
            );

            this.compositor.uploadTexture(this.fontTexture);
        },

        /**
         * Create a pattern with the specified repetition
         * @name createPattern
         * @memberOf me.WebGLRenderer
         * @function
         * @param {image} image Source image
         * @param {String} repeat Define how the pattern should be repeated
         * @return {me.video.renderer.Texture}
         * @see me.ImageLayer#repeat
         * @example
         * var tileable   = renderer.createPattern(image, "repeat");
         * var horizontal = renderer.createPattern(image, "repeat-x");
         * var vertical   = renderer.createPattern(image, "repeat-y");
         * var basic      = renderer.createPattern(image, "no-repeat");
         */
        createPattern : function (image, repeat) {

            if (!me.Math.isPowerOfTwo(image.width) || !me.Math.isPowerOfTwo(image.height)) {
                throw new me.video.Error(
                    "[WebGL Renderer] " + image + " is not a POT texture " +
                    "(" + image.width + "x" + image.height + ")"
                );
            }

            var texture = new this.Texture(
                this.Texture.prototype.createAtlas.apply(
                    this.Texture.prototype,
                    [ image.width, image.height, "pattern", repeat]
                ),
                image
            );

            // FIXME: Remove old cache entry and texture when changing the repeat mode
            this.compositor.uploadTexture(texture);

            return texture;
        },

        /**
         * Flush the compositor to the frame buffer
         * @name flush
         * @memberOf me.WebGLRenderer
         * @function
         */
        flush : function () {
            for (var i = 0; i < this.compositor.units.length; i++)
            {
                this.compositor.flush(i);
            }
        },

        /**
         * Clears the gl context with the given color.
         * @name clearColor
         * @memberOf me.WebGLRenderer
         * @function
         * @param {me.Color|String} color CSS color.
         * @param {Boolean} [opaque=false] Allow transparency [default] or clear the surface completely [true]
         */
        clearColor : function (col, opaque) {
            this.save();
            this.resetTransform();
            this.currentColor.copy(col);
            if (opaque) {
                this.compositor.clear();
            }
            else {
                this.fillRect(0, 0, this.canvas.width, this.canvas.height);
            }
            this.restore();
        },

        /**
         * Sets all pixels in the given rectangle to transparent black, <br>
         * erasing any previously drawn content.
         * @name clearRect
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Number} x x axis of the coordinate for the rectangle starting point.
         * @param {Number} y y axis of the coordinate for the rectangle starting point.
         * @param {Number} width The rectangle's width.
         * @param {Number} height The rectangle's height.
         */
        clearRect : function (x, y, width, height) {
            var color = this.currentColor.clone();
            this.currentColor.copy("#0000");
            this.fillRect(x, y, width, height);
            this.currentColor.copy(color);
            me.pool.push(color);
        },

        /**
         * @ignore
         */
        drawFont : function (bounds) {
            var fontContext = this.getFontContext();

            // Flush the compositor so we can upload a new texture
            this.flush();

            // Force-upload the new texture
            this.compositor.uploadTexture(this.fontTexture, 0, 0, 0, true);

            // Add the new quad
            var key = bounds.pos.x + "," + bounds.pos.y + "," + bounds.width + "," + bounds.height;
            this.compositor.addQuad(
                this.fontTexture,
                key,
                bounds.pos.x,
                bounds.pos.y,
                bounds.width,
                bounds.height
            );

            // Clear font context2D
            fontContext.clearRect(0, 0, this.backBufferCanvas.width, this.backBufferCanvas.height);
        },

        /**
         * Draw an image to the gl context
         * @name drawImage
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Image} image Source image
         * @param {Number} sx Source x-coordinate
         * @param {Number} sy Source y-coordinate
         * @param {Number} sw Source width
         * @param {Number} sh Source height
         * @param {Number} dx Destination x-coordinate
         * @param {Number} dy Destination y-coordinate
         * @param {Number} dw Destination width
         * @param {Number} dh Destination height
         * @example
         * // Can be used in three ways:
         * renderer.drawImage(image, dx, dy);
         * renderer.drawImage(image, dx, dy, dw, dh);
         * renderer.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
         * // dx, dy, dw, dh being the destination target & dimensions. sx, sy, sw, sh being the position & dimensions to take from the image
         */
        drawImage : function (image, sx, sy, sw, sh, dx, dy, dw, dh) {
            // TODO: Replace the function signature with:
            // drawImage(Image|Object, sx, sy, sw, sh, dx, dy, dw, dh)
            if (typeof sw === "undefined") {
                sw = dw = image.width;
                sh = dh = image.height;
                dx = sx;
                dy = sy;
                sx = 0;
                sy = 0;
            }
            else if (typeof dx === "undefined") {
                dx = sx;
                dy = sy;
                dw = sw;
                dh = sh;
                sw = image.width;
                sh = image.height;
                sx = 0;
                sy = 0;
            }

            if (this.subPixel === false) {
                // clamp to pixel grid
                dx = ~~dx;
                dy = ~~dy;
            }

            var key = sx + "," + sy + "," + sw + "," + sh;
            this.compositor.addQuad(this.cache.get(image), key, dx, dy, dw, dh);
        },

        /**
         * Draw a pattern within the given rectangle.
         * @name drawPattern
         * @memberOf me.WebGLRenderer
         * @function
         * @param {me.video.renderer.Texture} pattern Pattern object
         * @param {Number} x
         * @param {Number} y
         * @param {Number} width
         * @param {Number} height
         * @see me.WebGLRenderer#createPattern
         */
        drawPattern : function (pattern, x, y, width, height) {
            var key = "0,0," + width + "," + height;
            this.compositor.addQuad(pattern, key, x, y, width, height);
        },

        /**
         * Draw a filled rectangle at the specified coordinates
         * @name fillRect
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Number} x
         * @param {Number} y
         * @param {Number} width
         * @param {Number} height
         */
        fillRect : function (x, y, width, height) {
            this.compositor.addQuad(this.fillTexture, "default", x, y, width, height);
        },

        /**
         * return a reference to the screen canvas corresponding WebGL Context
         * @name getScreenContext
         * @memberOf me.WebGLRenderer
         * @function
         * @return {WebGLRenderingContext}
         */
        getScreenContext : function () {
            return this.gl;
        },

        /**
         * Returns the WebGL Context object of the given Canvas
         * @name getContextGL
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Canvas} canvas
         * @param {Boolean} [transparent=true] use false to disable transparency
         * @return {WebGLRenderingContext}
         */
        getContextGL : function (c, transparent) {
            if (typeof c === "undefined" || c === null) {
                throw new me.video.Error(
                    "You must pass a canvas element in order to create " +
                    "a GL context"
                );
            }

            if (typeof c.getContext === "undefined") {
                throw new me.video.Error(
                    "Your browser does not support WebGL."
                );
            }

            if (typeof transparent !== "boolean") {
                transparent = true;
            }

            var attr = {
                alpha : transparent,
                antialias : this.antiAlias,
                depth : false,
                premultipliedAlpha: transparent,
                failIfMajorPerformanceCaveat : this.failIfMajorPerformanceCaveat
            };

            return (
                c.getContext("webgl", attr) ||
                c.getContext("experimental-webgl", attr)
            );
        },

        /**
         * Returns the WebGLContext instance for the renderer
         * return a reference to the system 2d Context
         * @name getContext
         * @memberOf me.WebGLRenderer
         * @function
         * @return {WebGLRenderingContext}
         */
        getContext : function () {
            return this.gl;
        },

        /**
         * set a blend mode for the given context
         * @name setBlendMode
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Context2d} context
         * @param {String} [mode="normal"] blend mode : "normal", "multiply"
         */
        setBlendMode : function (gl, mode) {
            this.blendMode = mode;
            gl.enable(gl.BLEND);
            switch (mode) {
                case "multiply" :
                    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                    break;

                default :
                    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                    this.blendMode = "normal";
                    break;
            }
        },

        /**
         * return a reference to the font 2d Context
         * @ignore
         */
        getFontContext : function () {
            if (typeof (this.fontContext2D) === "undefined" ) {
                // warn the end user about performance impact
                console.warn("[WebGL Renderer] WARNING : Using Standard me.Font with WebGL will severly impact performances !");
                // create the font texture if not done yet
                this.createFontTexture(this.cache);
            }
            return this.fontContext2D;
        },

        /**
         * scales the canvas & GL Context
         * @name scaleCanvas
         * @memberOf me.WebGLRenderer
         * @function
         */
        scaleCanvas : function (scaleX, scaleY) {
            var w = this.canvas.width * scaleX;
            var h = this.canvas.height * scaleY;

            // adjust CSS style for High-DPI devices
            if (me.device.devicePixelRatio > 1) {
                this.canvas.style.width = (w / me.device.devicePixelRatio) + "px";
                this.canvas.style.height = (h / me.device.devicePixelRatio) + "px";
            }
            else {
                this.canvas.style.width = w + "px";
                this.canvas.style.height = h + "px";
            }

            this.compositor.setProjection(this.canvas.width, this.canvas.height, this.canvasScaleFactor);
        },

        /**
         * restores the canvas context
         * @name restore
         * @memberOf me.WebGLRenderer
         * @function
         */
        restore : function () {
            // do nothing if there is no saved states
            if (this._matrixStack.length !== 0) {
                var color = this._colorStack.pop();
                var matrix = this._matrixStack.pop();

                // restore the previous context
                this.currentColor.copy(color);
                this.currentTransform.copy(matrix);

                // recycle objects
                me.pool.push(color);
                me.pool.push(matrix);
            }

            if (this._scissorStack.length !== 0) {
                // FIXME : prevent `scissor` object realloc and GC
                this.currentScissor.set(this._scissorStack.pop());
            } else {
                // turn off scissor test
                this.gl.disable(this.gl.SCISSOR_TEST);
                this.currentScissor[0] = 0;
                this.currentScissor[1] = 0;
                this.currentScissor[2] = this.backBufferCanvas.width;
                this.currentScissor[3] = this.backBufferCanvas.height;
            }
        },

        /**
         * saves the canvas context
         * @name save
         * @memberOf me.WebGLRenderer
         * @function
         */
        save : function () {
            this._colorStack.push(this.currentColor.clone());
            this._matrixStack.push(this.currentTransform.clone());

            if (this.gl.isEnabled(this.gl.SCISSOR_TEST)) {
                // FIXME avoid slice and object realloc
                this._scissorStack.push(this.currentScissor.slice());
            }
        },

        /**
         * rotates the uniform matrix
         * @name rotate
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Number} angle in radians
         */
        rotate : function (angle) {
            this.currentTransform.rotate(angle);
        },

        /**
         * scales the uniform matrix
         * @name scale
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Number} x
         * @param {Number} y
         */
        scale : function (x, y) {
            this.currentTransform.scale(x, y);
        },

        /**
         * not used by this renderer?
         * @ignore
         */
        setAntiAlias : function (context, enable) {
            this._super(me.Renderer, "setAntiAlias", [context, enable]);
            // TODO: perhaps handle GLNEAREST or other options with texture binding
        },

        /**
         * Sets the global alpha
         * @name setGlobalAlpha
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Number} alpha 0.0 to 1.0 values accepted.
         */
        setGlobalAlpha : function (a) {
            this.currentColor.glArray[3] = a;
        },

        /**
         * Sets the color for further draw calls
         * @name setColor
         * @memberOf me.WebGLRenderer
         * @function
         * @param {me.Color|String} color css color string.
         */
        setColor : function (color) {
            var alpha = this.currentColor.glArray[3];
            this.currentColor.copy(color);
            this.currentColor.glArray[3] *= alpha;
        },

        /**
         * Set the line width
         * @name setLineWidth
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Number} width Line width
         */
        setLineWidth : function (width) {
            this.getScreenContext().lineWidth(width);
        },

        /**
         * Stroke an arc at the specified coordinates with given radius, start and end points
         * @name strokeArc
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Number} x arc center point x-axis
         * @param {Number} y arc center point y-axis
         * @param {Number} radius
         * @param {Number} start start angle in radians
         * @param {Number} end end angle in radians
         * @param {Boolean} [antiClockwise=false] draw arc anti-clockwise
         */
        strokeArc : function (/*x, y, radius, start, end, antiClockwise*/) {
            // TODO
        },

        /**
         * Stroke an ellipse at the specified coordinates with given radius, start and end points
         * @name strokeEllipse
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Number} x arc center point x-axis
         * @param {Number} y arc center point y-axis
         * @param {Number} w horizontal radius of the ellipse
         * @param {Number} h vertical radius of the ellipse
         */
        strokeEllipse : function (/*x, y, w, h*/) {
            // TODO
        },

        /**
         * Stroke a line of the given two points
         * @name strokeLine
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Number} startX the start x coordinate
         * @param {Number} startY the start y coordinate
         * @param {Number} endX the end x coordinate
         * @param {Number} endY the end y coordinate
         */
        strokeLine : function (startX, startY, endX, endY) {
            var points = this._linePoints.slice(0, 2);
            points[0].x = startX;
            points[0].y = startY;
            points[1].x = endX;
            points[1].y = endY;
            this.compositor.drawLine(points, true);
        },

        /**
         * Strokes a me.Polygon on the screen with a specified color
         * @name strokePolygon
         * @memberOf me.WebGLRenderer
         * @function
         * @param {me.Polygon} poly the shape to draw
         */
        strokePolygon : function (poly) {
            var len = poly.points.length,
                points,
                i;

            // Grow internal points buffer if necessary
            for (i = this._linePoints.length; i < len; i++) {
                this._linePoints.push(new me.Vector2d());
            }

            points = this._linePoints.slice(0, len);
            for (i = 0; i < len; i++) {
                points[i].x = poly.pos.x + poly.points[i].x;
                points[i].y = poly.pos.y + poly.points[i].y;
            }
            this.compositor.drawLine(points);
        },

        /**
         * Draw a stroke rectangle at the specified coordinates
         * @name strokeRect
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Number} x
         * @param {Number} y
         * @param {Number} width
         * @param {Number} height
         */
        strokeRect : function (x, y, width, height) {
            var points = this._linePoints.slice(0, 4);
            points[0].x = x;
            points[0].y = y;
            points[1].x = x + width;
            points[1].y = y;
            points[2].x = x + width;
            points[2].y = y + height;
            points[3].x = x;
            points[3].y = y + height;
            this.compositor.drawLine(points);
        },

        /**
         * draw the given shape
         * @name drawShape
         * @memberOf me.WebGLRenderer
         * @function
         * @param {me.Rect|me.Polygon|me.Line|me.Ellipse} shape a shape object
         */
        drawShape : function (shape) {
            if (shape.shapeType === "Rectangle") {
                this.strokeRect(shape.left, shape.top, shape.width, shape.height);
            } else if (shape instanceof me.Line || shape instanceof me.Polygon) {
                this.strokePolygon(shape);
            } else if (shape instanceof me.Ellipse) {
                if (shape.radiusV.x === shape.radiusV.y) {
                    // it's a circle
                    this.strokeArc(
                        shape.pos.x - shape.radius,
                        shape.pos.y - shape.radius,
                        shape.radius,
                        0,
                        2 * Math.PI
                    );
                } else {
                    // it's an ellipse
                    this.strokeEllipse(
                        shape.pos.x,
                        shape.pos.y,
                        shape.radiusV.x,
                        shape.radiusV.y
                    );
                }
            }
        },

        /**
         * Resets (overrides) the renderer transformation matrix to the
         * identity one, and then apply the given transformation matrix.
         * @name setTransform
         * @memberOf me.WebGLRenderer
         * @function
         * @param {me.Matrix2d} mat2d Matrix to transform by
         */
        setTransform : function (mat2d) {
            this.resetTransform();
            this.transform(mat2d);
        },

        /**
         * Multiply given matrix into the renderer tranformation matrix
         * @name transform
         * @memberOf me.WebGLRenderer
         * @function
         * @param {me.Matrix2d} mat2d Matrix to transform by
         */
        transform : function (mat2d) {
            this.currentTransform.multiply(mat2d);
            if (this.subPixel === false) {
                // snap position values to pixel grid
                var a = this.currentTransform.val;
                a[6] = ~~a[6];
                a[7] = ~~a[7];
            }
        },

        /**
         * Translates the uniform matrix by the given coordinates
         * @name translate
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Number} x
         * @param {Number} y
         */
        translate : function (x, y) {
            if (this.subPixel === false) {
                this.currentTransform.translate(~~x, ~~y);
            } else {
                this.currentTransform.translate(x, y);
            }
        },

        /**
         * clip the given region from the original canvas. Once a region is clipped,
         * all future drawing will be limited to the clipped region.
         * You can however save the current region using the save(),
         * and restore it (with the restore() method) any time in the future.
         * (<u>this is an experimental feature !</u>)
         * @name clipRect
         * @memberOf me.WebGLRenderer
         * @function
         * @param {Number} x
         * @param {Number} y
         * @param {Number} width
         * @param {Number} height
         */
        clipRect : function (x, y, width, height) {
            var canvas = this.backBufferCanvas;
            // if requested box is different from the current canvas size
            if (x !== 0 || y !== 0 || width !== canvas.width || height !== canvas.height) {
                var gl = this.gl;
                var currentScissor = this.currentScissor;
                if (gl.isEnabled(gl.SCISSOR_TEST)) {
                    // if same as the current scissor box do nothing
                    if (currentScissor[0] === x && currentScissor[1] === y &&
                        currentScissor[2] === width && currentScissor[3] === height) {
                            return;
                    }
                }
                // flush the compositor
                this.flush();
                // turn on scissor test
                gl.enable(this.gl.SCISSOR_TEST);
                // set the scissor rectangle (note : coordinates are left/bottom)
                gl.scissor(
                    // scissor does not account for currentTransform, so manually adjust
                    x + this.currentTransform.tx,
                    canvas.height -height -y -this.currentTransform.ty,
                    width,
                    height
                );
                // save the new currentScissor box
                currentScissor[0] = x;
                currentScissor[1] = y;
                currentScissor[2] = width;
                currentScissor[3] = height;
            } else {
                // turn off scissor test
                gl.disable(gl.SCISSOR_TEST);
            }
        }
    });

})();
