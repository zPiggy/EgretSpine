namespace spine {

    export function createSkeletonData(jsonData: string | {}, atlas: TextureAtlas) {
        const skelJson = new SkeletonJson(new AtlasAttachmentLoader(atlas));
        return skelJson.readSkeletonData(jsonData);
    }

    export function createSkeletonDataByBinary(binary: Uint8Array, atlas: TextureAtlas) {
        const skelBinary = new SkeletonBinary(new AtlasAttachmentLoader(atlas));
        return skelBinary.readSkeletonData(binary);
    }

    export function createTextureAtlas(atlasData: string, textures: Record<string, egret.Texture>) {
        return new TextureAtlas(atlasData, (file: string) => {
            return new EgretTexture(textures[file]);
        });
    }

    class EgretTexture extends Texture {
        public smoothing: boolean = false;

        public constructor(readonly original: egret.Texture) {
            super(original.bitmapData.source);
        }

        public setFilters(minFilter: TextureFilter, magFilter: TextureFilter): void {
            const { Nearest, MipMapNearestNearest } = TextureFilter;
            const minSmoothing = minFilter !== Nearest && minFilter !== MipMapNearestNearest;
            const magSmoothing = magFilter !== Nearest && magFilter !== MipMapNearestNearest;

            this.smoothing = minSmoothing || magSmoothing;
        }

        public setWraps(uWrap: TextureWrap, vWrap: TextureWrap): void { }

        public dispose(): void { }
    }


    export class SkeletonRenderer extends egret.DisplayObjectContainer {
        static QUAD_TRIANGLES = [0, 1, 2, 2, 3, 0];
        // x y r g b a u v
        static VERTEX_SIZE = 2 + 4 + 2;

        public readonly skeleton: Skeleton;
        public readonly skeletonData: SkeletonData;
        public readonly state: AnimationState;
        public readonly stateData: AnimationStateData;
        public readonly slotRenderers: SlotRenderer[] = [];

        /**双色 (默认不开启)*/
        public twoColorTint: boolean;
        /**颜色预乘 (默认不开启)*/
        public premultipliedAlpha = false;
        /**裁剪 */
        public readonly clipper: SkeletonClipping = new SkeletonClipping();
        /**顶点特效 (暂不支持) */
        public vertexEffect: VertexEffect = null;       // TODO 未实现 VertexEffect 类



        public constructor(skeletonData: SkeletonData, twoColorTint: boolean = false) {
            super();
            this.scaleY = -1;
            this.touchEnabled = true;
            this.skeletonData = skeletonData;
            this.stateData = new AnimationStateData(skeletonData);
            this.state = new AnimationState(this.stateData);
            this.skeleton = new Skeleton(skeletonData);
            this.skeleton.updateWorldTransform();
            this.skeleton.setSlotsToSetupPose();
            //
            this.premultipliedAlpha = false;
            this.twoColorTint = twoColorTint;


            for (const slot of this.skeleton.slots) {
                const renderer = new SlotRenderer(slot);

                renderer.renderSlot(this);
                this.addChild(renderer);
                this.slotRenderers.push(renderer);
            }
            this.clipper.clipEnd();

        }

        public findSlotRenderer(name: string): SlotRenderer | undefined {
            return this.slotRenderers.find(it => it.name === name);
        }

        public update(dt: number) {
            this.state.update(dt);
            this.state.apply(this.skeleton);
            this.skeleton.updateWorldTransform();

            const drawOrder = this.skeleton.drawOrder;

            for (let i = 0; i < drawOrder.length; i++) {
                const index = drawOrder[i].data.index;
                const renderer = this.slotRenderers[index];

                if (renderer.zIndex !== i) {
                    renderer.zIndex = i;
                }
                renderer.renderSlot(this);
            }

            this.clipper.clipEnd();
        }
    }

    export class SlotRenderer extends egret.Mesh {

        public constructor(readonly slot: Slot) {
            super();
            this.name = slot.data.name;
            let blendMode = slot.data.blendMode;
            switch (blendMode) {
                case BlendMode.Normal:
                    this.blendMode = egret.BlendMode.NORMAL;
                    break;
                case BlendMode.Additive:
                    this.blendMode = egret.BlendMode.ADD;
                    break;
                case BlendMode.Multiply:
                    this.blendMode = egret.BlendMode.NORMAL;
                    break;
                case BlendMode.Screen:
                    this.blendMode = egret.BlendMode.NORMAL;
                    break;
                default:
                    this.blendMode = egret.BlendMode.NORMAL;
                    break;
            }
        }

        public renderSlot(skelRender: SkeletonRenderer) {
            const slot = this.slot;
            const attachment = slot.getAttachment();
            const clipper = skelRender.clipper;
            if (attachment == null) {
                this.visible = false;
                clipper.clipEndWithSlot(slot);
                return;
            }

            const premultipliedAlpha = skelRender.premultipliedAlpha;
            const twoColorTint = skelRender.twoColorTint;
            const meshNode = this.$renderNode as egret.sys.MeshNode;

            let attachmentColor: Color;
            let uvs: number[] = meshNode.uvs;
            let triangles: number[] = meshNode.indices;
            let verticesXY: number[] = meshNode.vertices;
            let texture: EgretTexture;

            if (attachment instanceof RegionAttachment) {
                attachmentColor = attachment.color;
                uvs = this.copyArray(attachment.uvs, uvs);
                triangles = this.copyArray(SkeletonRenderer.QUAD_TRIANGLES, triangles);
                texture = (attachment.region as TextureAtlasRegion).texture as EgretTexture;
                verticesXY = this.getRegionAttachmentVertices(attachment, verticesXY) as number[];
            }
            else if (attachment instanceof MeshAttachment) {
                attachmentColor = attachment.color;
                uvs = this.copyArray(attachment.uvs, uvs);
                triangles = this.copyArray(attachment.triangles, triangles);
                texture = (attachment.region as TextureAtlasRegion).texture as EgretTexture;
                verticesXY = this.getMeshAttachmentVertices(attachment, verticesXY) as number[];
            }
            else if (attachment instanceof ClippingAttachment) {
                this.visible = false;
                clipper.clipStart(slot, attachment);
                return;
            }
            else {
                // no supported attachment.
                this.visible = false;
                clipper.clipEndWithSlot(slot);
                return;
            }

            if (texture == null) {
                this.visible = false;
                clipper.clipEndWithSlot(slot);
                return;
            }

            // 计算裁剪
            if (clipper.isClipping()) {
                this.clippingVertices(clipper, uvs, verticesXY, triangles);
            }

            if (verticesXY.length == 0 || triangles.length === 0) {
                this.visible = false;
                clipper.clipEndWithSlot(slot);
                return;
            }

            // TODO vertexEffect ?
            // if (vertexEffect) { }


            // #region 渲染
            let darkColor = (twoColorTint && slot.darkColor) ? slot.darkColor : null;
            this.updateColor(attachmentColor, premultipliedAlpha, darkColor);
            this.updateRenderData(texture, uvs, verticesXY, triangles);

            this.visible = true;
            // #endregion 渲染

            clipper.clipEndWithSlot(slot);

        }

        // NOTICE: CustomFilter 性能不佳
        private updateColor(lightColor: Color, premultipliedAlpha: boolean = false, darkColor: Color = null) {
            const skelColor = this.slot.bone.skeleton.color;
            const slotColor = this.slot.color;

            const alpha = skelColor.a * slotColor.a * lightColor.a;
            const scale = premultipliedAlpha ? 255 * alpha : 255;
            // 0-1 转 255
            const r = skelColor.r * slotColor.r * lightColor.r * scale;
            const g = skelColor.g * slotColor.g * lightColor.g * scale;
            const b = skelColor.b * slotColor.b * lightColor.b * scale;

            this.tint = (r << 16) + (g << 8) + (b | 0);
            this.alpha = premultipliedAlpha ? 1 : alpha;

            if (darkColor == null) {
                this.filters = null;
                return;
            }

            // 使用 filters drawcall 很高
            if (darkColor.r != 1 || darkColor.g != 1 || darkColor.b != 1 || darkColor.a != 1) {
                // TODO 未验证染色值是否需要处理 premultipliedAlpha 
                // 0-1 转 255
                let dr = darkColor.r * scale;
                let dg = darkColor.g * scale;
                let db = darkColor.b * scale;

                // 无效的染色滤镜
                if (dr == 0 && dg == 0 && db == 0) {
                    this.filters = null;
                    return;
                }

                // NOTICE: spine 中的 "Tint Black" 为颜色相加
                var colorMatrix = [
                    1, 0, 0, 0, dr,
                    0, 1, 0, 0, dg,
                    0, 0, 1, 0, db,
                    0, 0, 0, 1, 0
                ];
                var colorFlilter = new egret.ColorMatrixFilter(colorMatrix);
                this.filters = [colorFlilter];
            }
        }


        private updateRenderData(texture: EgretTexture, uvs: ArrayLike<number>, verticesXY: ArrayLike<number>, indices: ArrayLike<number>) {
            const meshNode = this.$renderNode as egret.sys.MeshNode;
            let egretTexture: egret.Texture = texture.original;
            meshNode.uvs = uvs as number[];
            meshNode.indices = indices as number[];
            meshNode.vertices = verticesXY as number[];

            this.texture = egretTexture;
            this.$smoothing = texture.smoothing;

            this.$updateVertices();
        }

        private getRegionAttachmentVertices(attachment: RegionAttachment, outVerticesXY?: ArrayLike<number>) {
            outVerticesXY = outVerticesXY || [];
            outVerticesXY.length = 8;
            attachment.computeWorldVertices(this.slot.bone, outVerticesXY, 0, 2);

            return outVerticesXY;
        }

        private getMeshAttachmentVertices(attachment: MeshAttachment, outVerticesXY?: ArrayLike<number>) {
            outVerticesXY = outVerticesXY || [];
            outVerticesXY.length = attachment.worldVerticesLength;
            attachment.computeWorldVertices(this.slot, 0, attachment.worldVerticesLength, outVerticesXY, 0, 2);

            return outVerticesXY;
        }

        private clippingVertices(clipper: SkeletonClipping, uvs: ArrayLike<number>, verticesXY: ArrayLike<number>, indices: ArrayLike<number>) {
            clipper.clipTriangles(verticesXY, verticesXY.length, indices, indices.length, uvs, new Color(1, 1, 1, 1), null, false);

            // 从裁剪数据中获取新的顶点和uv
            // x y r g b a u v
            let clippedVertices = clipper.clippedVertices;
            let clippedTriangles = clipper.clippedTriangles;

            indices.length = clippedTriangles.length;
            verticesXY.length = 0;
            uvs.length = 0;

            // fill indices
            for (let i = 0; i < clippedTriangles.length; i++) {
                indices[i] = clippedTriangles[i];
            }

            // fill uvs and vertices
            let offset = 0;
            let offset_1 = 0;
            for (let i = 0; i < clippedVertices.length;) {
                offset_1 = offset + 1;

                verticesXY[offset] = clippedVertices[i];        // x
                verticesXY[offset_1] = clippedVertices[i + 1];  // y

                uvs[offset] = clippedVertices[i + 6];           // u
                uvs[offset_1] = clippedVertices[i + 7];         // v

                offset += 2;
                i += 8;
            }
        }



        private copyArray(srcArray: ArrayLike<number>, outArray?: number[]) {
            outArray = outArray || [];
            outArray.length = srcArray.length;
            for (let i = 0; i < srcArray.length; i++) {
                outArray[i] = srcArray[i];
            }
            return outArray;
        }

    }
}