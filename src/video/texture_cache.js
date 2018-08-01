/*
* MelonJS Game Engine
* Copyright (C) 2011 - 2018 Olivier Biot
* http://www.melonjs.org
*
*/
(function () {

    /**
     * a basic texture cache object
     * @ignore
     */
    me.Renderer.TextureCache = me.Object.extend({
        /**
         * @ignore
         */
        init : function (max_size) {
            this.cache = [];
            this.cache.push(new Map());
            this.units = [];
            this.units.push(new Map());
            this.max_size = max_size || Infinity;

            this.reset();
        },

        /**
         * @ignore
         */
        reset : function () {
            this.cache.forEach(
                function(e)
                {
                    e.clear();
                }
            );
            this.units.forEach(
                function(e)
                {
                    e.clear();
                }
            );
            
            this.length = [0];
            this.addIndex = 0;
        },

        /**
         * @ignore
         */
        validate : function () {
            if (this.length[this.addIndex] >= this.max_size) {
                // TODO: Merge textures instead of throwing an exception
                // throw new me.video.Error(
                //     "Texture cache overflow: " + this.max_size +
                //     " texture units available."
                // );
                this.addIndex ++;
                this.cache.push(new Map());
                this.units.push(new Map());
                this.length.push(0);
                return false;
            }
            return true;
        },

        contains: function(image) {
            for (var i = 0; i < this.cache.length; i++)
            {
                if (this.cache[i].has(image))
                {
                    return true;
                }
            }
            return false;
        },

        /**
         * @ignore
         */
        get : function (image, atlas) {
            if (!this.contains(image)) {
                if (!atlas) {
                    atlas = me.video.renderer.Texture.prototype.createAtlas.apply(
                        me.video.renderer.Texture.prototype,
                        [image.width, image.height, image.src ? me.utils.file.getBasename(image.src) : undefined]
                    );
                }
                this.put(image, new me.video.renderer.Texture(atlas, image, false));
            }

            for (var i = 0; i < this.cache.length; i++)
            {
                if (this.cache[i].has(image))
                {
                    return this.cache[i].get(image);
                }
            }
        },

        /**
         * @ignore
         */
        put : function (image, texture) {
            this.validate();
            this.cache[this.addIndex].set(image, texture);
            this.units[this.addIndex].set(texture, this.length[this.addIndex]++);
        },

        /**
         * @ignore
         */
        getBatch : function (texture) {
            for (var i = 0; i < this.units.length; i++)
            {
                if (this.units[i].has(texture))
                {
                    return i;
                }
            }
        },

        /**
         * @ignore
         */
        getUnit : function (texture) {
            for (var i = 0; i < this.units.length; i++)
            {
                if (this.units[i].has(texture))
                {
                    return this.units[i].get(texture);
                }
            }
        }
    });

})();
