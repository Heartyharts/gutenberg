/**
 * External dependencies
 */
import { keyBy, omit } from 'lodash';

/**
 * WordPress dependencies
 */
import { useDispatch, useSelect } from '@wordpress/data';
import { useEffect, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import useCreateMissingMenuItems from './use-create-missing-menu-items';

export default function useMenuItems( query ) {
	const menuItems = useFetchMenuItems( query );
	const saveMenuItems = useSaveMenuItems( query );
	const [ createMissingMenuItems, onCreated ] = useCreateMissingMenuItems();
	const eventuallySaveMenuItems = ( blocks ) =>
		onCreated( () => saveMenuItems( blocks ) );
	return { menuItems, eventuallySaveMenuItems, createMissingMenuItems };
}

export function useFetchMenuItems( query ) {
	const { menuItems, isResolving } = useSelect( ( select ) => ( {
		menuItems: select( 'core' ).getMenuItems( query ),
		isResolving: select( 'core/data' ).isResolving(
			'core',
			'getMenuItems',
			[ query ]
		),
	} ) );

	const [ resolvedMenuItems, setResolvedMenuItems ] = useState( null );

	useEffect( () => {
		if ( isResolving || menuItems === null ) {
			return;
		}

		setResolvedMenuItems( menuItems );
	}, [ isResolving, menuItems ] );

	return resolvedMenuItems;
}

function mapMenuItemsByClientId( menuItems, clientIdsByMenuId ) {
	const result = {};
	if ( ! menuItems || ! clientIdsByMenuId ) {
		return result;
	}
	for ( const menuItem of menuItems ) {
		const clientId = clientIdsByMenuId[ menuItem.id ];
		if ( clientId ) {
			result[ clientId ] = menuItem;
		}
	}
	return result;
}

export function useSaveMenuItems( query ) {
	const { createSuccessNotice, createErrorNotice } = useDispatch(
		'core/notices'
	);
	const select = useSelect( ( s ) => s );

	const saveBlocks = async ( blocks ) => {
		const menuItems = select( 'core' ).getMenuItems( query );
		const menuitemIdToClientIdMapping = select(
			'core/edit-navigation'
		).getMenuItemIdToClientIdMapping( query );
		const menuItemsByClientId = mapMenuItemsByClientId(
			menuItems,
			menuitemIdToClientIdMapping
		);

		const result = await batchSave(
			query.menus,
			menuItemsByClientId,
			blocks[ 0 ]
		);

		if ( result.success ) {
			createSuccessNotice( __( 'Navigation saved.' ), {
				type: 'snackbar',
			} );
		} else {
			createErrorNotice( __( 'There was an error.' ), {
				type: 'snackbar',
			} );
		}
	};

	return saveBlocks;
}

async function batchSave( menuId, menuItemsByClientId, navigationBlock ) {
	const { nonce, stylesheet } = await apiFetch( {
		path: '/__experimental/customizer-nonces/get-save-nonce',
	} );

	// eslint-disable-next-line no-undef
	const body = new FormData();
	body.append( 'wp_customize', 'on' );
	body.append( 'customize_theme', stylesheet );
	body.append( 'nonce', nonce );
	body.append( 'customize_changeset_uuid', uuidv4() );
	body.append( 'customize_autosaved', 'on' );
	body.append( 'customize_changeset_status', 'publish' );
	body.append( 'action', 'customize_save' );
	body.append(
		'customized',
		computeCustomizedAttribute(
			navigationBlock.innerBlocks,
			menuId,
			menuItemsByClientId
		)
	);

	return await apiFetch( {
		url: '/wp-admin/admin-ajax.php',
		method: 'POST',
		body,
	} );
}

function computeCustomizedAttribute( blocks, menuId, menuItemsByClientId ) {
	const blocksList = blocksTreeToFlatList( blocks );
	const dataList = blocksList.map( ( { block, parentId, position } ) =>
		linkBlockToRequestItem( block, parentId, position )
	);

	// Create an object like { "nav_menu_item[12]": {...}} }
	const computeKey = ( item ) => `nav_menu_item[${ item.id }]`;
	const dataObject = keyBy( dataList, computeKey );

	// Deleted menu items should be sent as false, e.g. { "nav_menu_item[13]": false }
	for ( const clientId in menuItemsByClientId ) {
		const key = computeKey( menuItemsByClientId[ clientId ] );
		if ( ! ( key in dataObject ) ) {
			dataObject[ key ] = false;
		}
	}

	return JSON.stringify( dataObject );

	function blocksTreeToFlatList( innerBlocks, parentId = 0 ) {
		return innerBlocks.flatMap( ( block, index ) =>
			[ { block, parentId, position: index + 1 } ].concat(
				blocksTreeToFlatList(
					block.innerBlocks,
					getMenuItemForBlock( block )?.id
				)
			)
		);
	}

	function linkBlockToRequestItem( block, parentId, position ) {
		const menuItem = omit( getMenuItemForBlock( block ), 'menus', 'meta' );
		return {
			...menuItem,
			position,
			title: block.attributes?.label,
			url: block.attributes.url,
			original_title: '',
			classes: ( menuItem.classes || [] ).join( ' ' ),
			xfn: ( menuItem.xfn || [] ).join( ' ' ),
			nav_menu_term_id: menuId,
			menu_item_parent: parentId,
			status: 'publish',
			_invalid: false,
		};
	}

	function getMenuItemForBlock( block ) {
		return omit( menuItemsByClientId[ block.clientId ] || {}, '_links' );
	}
}

function uuidv4() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace( /[xy]/g, ( c ) => {
		// eslint-disable-next-line no-restricted-syntax
		const a = Math.random() * 16;
		// eslint-disable-next-line no-bitwise
		const r = a | 0;
		// eslint-disable-next-line no-bitwise
		const v = c === 'x' ? r : ( r & 0x3 ) | 0x8;
		return v.toString( 16 );
	} );
}
