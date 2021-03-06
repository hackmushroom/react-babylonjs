/**
 * react-babylonjs
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import React, { createContext } from 'react'
import ReactReconciler from "react-reconciler"

import { WithBabylonJSContext, withBabylonJS } from './Engine'
import { Scene as BabylonScene, AbstractMesh, PointerInfo, PointerEventTypes, Color4, SceneOptions } from 'babylonjs'

import ReactBabylonJSHostConfig, { Container, applyUpdateToInstance } from './ReactBabylonJSHostConfig'
import { FiberScenePropsHandler } from './generatedCode'
import { UpdatePayload } from './PropsHandler';

export interface WithSceneContext {
  engine: BABYLON.Nullable<BABYLON.Engine>,
  canvas: BABYLON.Nullable<HTMLCanvasElement | WebGLRenderingContext>
  scene: BABYLON.Nullable<BABYLON.Scene>
}

export declare type SceneEventArgs = {
  scene: BabylonScene;
  canvas: HTMLCanvasElement;
};

// TODO: build a fallback mechanism when typeof React.createContext !== 'function'
export const SceneContext = createContext<WithSceneContext>({
  engine: null,
  canvas: null,
  scene: null
})

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

export function withScene<
  P extends { sceneContext?: WithSceneContext },
  R = Omit<P, 'sceneContext'>
  >(
  Component: React.ComponentClass<P> | React.StatelessComponent<P>
  ): React.SFC<R> {
  return function BoundComponent(props: R) {
    return (
      <SceneContext.Consumer>
        {ctx => <Component {...props} sceneContext={ctx} />}
      </SceneContext.Consumer>
    );
  };
}

interface SceneProps extends WithSceneContext {
  babylonJSContext: WithBabylonJSContext
  onMeshPicked?: (mesh: AbstractMesh, scene: BabylonScene) => void,
  onScenePointerDown?: (evt: PointerInfo, scene: BabylonScene) => void,
  onScenePointerUp?: (evt: PointerInfo, scene: BabylonScene) => void,
  onScenePointerMove?: (evt: PointerInfo, scene: BabylonScene) => void,
  onSceneMount?: (sceneEventArgs: SceneEventArgs) => void,
  clearColor?: Color4,
  sceneOptions: SceneOptions
}

class Scene extends React.Component<SceneProps, any, any> {
  private _scene: BABYLON.Nullable<BABYLON.Scene> = null;
  private _pointerDownObservable: BABYLON.Nullable<BABYLON.Observer<BABYLON.PointerInfo>> = null;
  private _pointerUpObservable: BABYLON.Nullable<BABYLON.Observer<BABYLON.PointerInfo>> = null;
  private _pointerMoveObservable: BABYLON.Nullable<BABYLON.Observer<BABYLON.PointerInfo>> = null;

  private _fiberRoot?: ReactReconciler.FiberRoot;
  private _reactReconcilerBabylonJs = ReactReconciler(ReactBabylonJSHostConfig)

  componentDidMount() {
    const { babylonJSContext } = this.props
    
    if (!babylonJSContext) {
      // we could try to create one here with existing props (ie: backwards compat?)
      console.error('You are creating a scene without an Engine.  \'SceneOnly\' will only work as a child of Engine, use \'Scene\' otherwise.')
      return
    }
      
    const { engine /*, canvas */ } = babylonJSContext;

    this._scene = new BABYLON.Scene(engine!, this.props.sceneOptions)
    const updates : UpdatePayload = new FiberScenePropsHandler().getPropertyUpdates(this._scene, {}, this.props as any, this._scene)
    if (updates != null) {
      updates.forEach(propertyUpdate => {
        applyUpdateToInstance(this._scene, propertyUpdate, 'scene')
      })
    }

    if (this.props.clearColor !== undefined) {
      this._scene!.clearColor = this.props.clearColor
    }

    // TODO: Add keypress and other PointerEventTypes:
    this._pointerDownObservable = this._scene!.onPointerObservable.add((evt: PointerInfo) => {

      if(typeof this.props.onScenePointerDown === 'function') {
        this.props.onScenePointerDown(evt, this._scene!)
      }

      if (evt && evt.pickInfo && evt.pickInfo.hit && evt.pickInfo.pickedMesh) {
        let mesh = evt.pickInfo.pickedMesh

        if (typeof this.props.onMeshPicked === 'function') {
          this.props.onMeshPicked(mesh, this._scene!)
        } else {
          // console.log('onMeshPicked not being called')
        }
      }
    }, PointerEventTypes.POINTERDOWN);

    // can only be assigned on init
    if(typeof this.props.onScenePointerUp === 'function') {
      this._pointerUpObservable = this._scene!.onPointerObservable.add((evt: PointerInfo) => { 
        this.props.onScenePointerUp!(evt, this._scene!)    
      }, PointerEventTypes.POINTERUP)
    };

    // can only be assigned on init
    if(typeof this.props.onScenePointerMove === 'function') {
      this._pointerMoveObservable = this._scene!.onPointerObservable.add((evt: PointerInfo) => { 
        this.props.onScenePointerMove!(evt, this._scene!)    
      }, PointerEventTypes.POINTERMOVE)
    };

    if (typeof this.props.onSceneMount === 'function') {
      this.props.onSceneMount({
          scene: this._scene!,
          canvas: this._scene!.getEngine().getRenderingCanvas()!
      });
      // TODO: console.error if canvas is not attached. runRenderLoop() is expected to be part of onSceneMount().
    }
    const isAsync = false // Disables experimental async rendering
    
    const container: Container = {
      engine: this.props.babylonJSContext.engine,
      canvas: this.props.babylonJSContext.canvas,
      scene: this._scene,
      rootInstance: {
        hostInstance: null,
        children: [],
        parent: null,
        metadata: {
          className: "root"
        },
        customProps: {}
      }
    }

    this._fiberRoot = this._reactReconcilerBabylonJs.createContainer(container, isAsync, false /* hydrate true == better HMR? */)
  
    this._reactReconcilerBabylonJs.injectIntoDevTools({
      bundleType: process.env.NODE_ENV === 'production' ? 0 : 1,
      version: '1.0.0',
      rendererPackageName: 'react-babylonjs'
    })

    // update the root Container
    // console.log("updating rootContainer (1) reactElement")
    return this._reactReconcilerBabylonJs.updateContainer(
      <SceneContext.Provider value={{ engine: this.props.babylonJSContext.engine, canvas: this.props.babylonJSContext.canvas, scene: this._scene }}>
        {this.props.children}
      </SceneContext.Provider>, this._fiberRoot, undefined /* TODO: try to dual-write for screen readers */, () => {}
    )
  }

  componentDidUpdate (prevProps: any, prevState: any) {
    // In the docs it is mentioned that shouldComponentUpdate() may be treated as a hint one day
    // avoid shouldComponentUpdate() => false, looks okay, but prop changes will lag behind 1 update.
    this._reactReconcilerBabylonJs.updateContainer(
      <SceneContext.Provider value={{ engine: this.props.babylonJSContext.engine, canvas: this.props.babylonJSContext.canvas, scene: this._scene }}>
        {this.props.children}
      </SceneContext.Provider>,
      this._fiberRoot!,
      undefined,
      () => { /* called after container is updated.  we may want an external observable here */ }
    )
  }

  componentWillUnmount () {
    if (this._pointerDownObservable != null) {
      this._scene!.onPointerObservable.remove(this._pointerDownObservable);
    }

    if (this._pointerUpObservable != null) {
      this._scene!.onPointerObservable.remove(this._pointerUpObservable);
    }

    if (this._pointerMoveObservable != null) {
      this._scene!.onPointerObservable.remove(this._pointerMoveObservable);
    }
    this._scene!.dispose()
  }

  render () {
    return null;
  }
}

// TODO: export a SceneOnly without engine and have this class create a default engine when not present.

// for backwards compatibility we export a scene with an Engine.  Engine is only needed with multi-scene.
export default withBabylonJS(Scene)